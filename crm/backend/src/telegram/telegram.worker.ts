import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TelegramStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Не более стольки сообщений за один проход — очередь не должна забивать событийный цикл */
const BATCH_SIZE = 20;
/** После стольких неудачных попыток сообщение считается недоставленным */
const MAX_ATTEMPTS = 5;
/** Нарастающая задержка перед повтором: 1 мин, 5 мин, 15 мин, 30 мин, 1 час */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
const SEND_TIMEOUT_MS = 10_000;

/**
 * Забирает сообщения со статусом PENDING и наступившим временем следующей
 * попытки и отправляет через Telegram Bot API. Перезапуск контейнера при
 * деплое не теряет сообщения — они остаются в очереди до следующего тика.
 *
 * Раньше проход был раз в минуту, и уведомление приходило с задержкой до
 * минуты — на живой заявке это заметно. Теперь отправку запускает сама
 * постановка в очередь (nudge), а периодический проход остаётся страховкой:
 * он подберёт то, что не ушло из-за недоступного Telegram или перезапуска.
 */
@Injectable()
export class TelegramWorker {
  private readonly logger = new Logger('TelegramWorker');

  constructor(private prisma: PrismaService) {}

  /** идёт ли проход сейчас — чтобы будильники не запускали его пачкой */
  private running = false;
  /** отложенный будильник: несколько сообщений подряд дают один проход */
  private nudgeTimer: NodeJS.Timeout | null = null;

  /**
   * Разобрать очередь как можно скорее.
   *
   * Небольшая задержка обязательна: сообщение часто ставится ВНУТРИ
   * транзакции бизнес-операции, и до её фиксации строки в базе ещё нет.
   * Если проход всё же опередит фиксацию, страховкой служит периодический
   * тик — сообщение не потеряется.
   */
  nudge(delayMs = 300): void {
    if (this.nudgeTimer) return;
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      void this.tick();
    }, delayMs);
  }

  @Interval(15_000)
  async tick(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return; // без токена не пытаемся вовсе — предупреждение уже дано при старте
    if (this.running) return; // проход уже идёт — второй только мешал бы
    this.running = true;
    try {
      const due = await this.prisma.telegramMessage.findMany({
        where: { status: TelegramStatus.PENDING, nextTryAt: { lte: new Date() } },
        orderBy: { nextTryAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const msg of due) {
        // Оптимистичный захват на случай нескольких инстансов бэкенда:
        // если запись уже забрал другой процесс — статус больше не PENDING.
        const claimed = await this.prisma.telegramMessage.updateMany({
          where: { id: msg.id, status: TelegramStatus.PENDING },
          data: { status: TelegramStatus.SENDING },
        });
        if (claimed.count === 0) continue;

        await this.sendOne(token, msg.id, msg.chatId, msg.text, msg.parseMode, msg.attempts);
      }
    } finally {
      this.running = false;
    }
  }

  private async sendOne(
    token: string,
    id: string,
    chatId: string,
    text: string,
    parseMode: string | null,
    attemptsBefore: number,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode ?? 'HTML',
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      const body: { ok?: boolean; description?: string } | null = await res
        .json()
        .catch(() => null);
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.description || `Telegram API вернул ${res.status}`);
      }
      await this.prisma.telegramMessage.update({
        where: { id },
        data: { status: TelegramStatus.SENT, sentAt: new Date() },
      });
    } catch (e) {
      const attempts = attemptsBefore + 1;
      // Токен намеренно не попадает в лог — только сообщение об ошибке
      const errorText = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      if (attempts >= MAX_ATTEMPTS) {
        this.logger.error(
          `Сообщение Telegram ${id} не доставлено после ${attempts} попыток: ${errorText}`,
        );
        await this.prisma.telegramMessage.update({
          where: { id },
          data: { status: TelegramStatus.FAILED, attempts, lastError: errorText },
        });
      } else {
        const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
        await this.prisma.telegramMessage.update({
          where: { id },
          data: {
            status: TelegramStatus.PENDING,
            attempts,
            lastError: errorText,
            nextTryAt: new Date(Date.now() + delay),
          },
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
