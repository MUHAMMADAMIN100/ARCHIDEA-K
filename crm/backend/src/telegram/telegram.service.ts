import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramWorker } from './telegram.worker';

/** Клиент Prisma или транзакция — как в audit.service.ts: очередь можно
 * писать внутри уже открытой транзакции, чтобы постановка сообщения
 * откатилась вместе с бизнес-операцией при сбое. */
type Db = PrismaService | Prisma.TransactionClient;

export interface EnqueueOptions {
  /** Категория сообщения для фильтров/отладки: "reminder" | "shift_closed" … */
  kind?: string;
  /** Id связанной сущности (напоминание, заказ, смена…) */
  refId?: string;
  parseMode?: 'HTML' | 'MarkdownV2';
}

/**
 * Исходящая очередь Telegram (durable outbox, ТЗ 10.2).
 *
 * Бизнес-код НИКОГДА не шлёт сообщение в Bot API напрямую: таймаут
 * api.telegram.org не должен ронять перевод заказа в «Оплачено», а
 * перезапуск контейнера при деплое Railway — терять уведомление.
 * Сообщение только кладётся в таблицу TelegramMessage; отправляет его
 * фоновый воркер (telegram.worker.ts). Постановка сразу будит воркер, поэтому
 * уведомление уходит через доли секунды, а не ждёт периодического прохода.
 *
 * Методы никогда не бросают исключение — сбой Telegram не должен ронять
 * вызвавшую бизнес-операцию.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger('Telegram');

  constructor(
    private prisma: PrismaService,
    private worker: TelegramWorker,
  ) {}

  onModuleInit(): void {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN не задан — уведомления в Telegram отправляться не будут (CRM продолжает работать без них)',
      );
    }
  }

  /** Поставить сообщение в очередь на произвольный chatId */
  async enqueue(
    chatId: string | null | undefined,
    text: string,
    opts: EnqueueOptions = {},
    db: Db = this.prisma,
  ): Promise<void> {
    if (!chatId || !text.trim()) return;
    try {
      await db.telegramMessage.create({
        data: {
          chatId,
          text,
          parseMode: opts.parseMode ?? 'HTML',
          kind: opts.kind ?? null,
          refId: opts.refId ?? null,
        },
      });
      // будим воркер: без этого сообщение ждало бы периодического прохода
      this.worker.nudge();
    } catch (e) {
      this.logger.error('Не удалось поставить сообщение Telegram в очередь', e as Error);
    }
  }

  /** Сообщение в общий рабочий чат компании (TELEGRAM_CHAT_ID) */
  async enqueueToCompanyChat(
    text: string,
    opts: EnqueueOptions = {},
    db: Db = this.prisma,
  ): Promise<void> {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return; // без чата компании молча пропускаем
    await this.enqueue(chatId, text, opts, db);
  }

  /**
   * Личное сообщение сотруднику — по его telegramChatId, если он привязан
   * и не отключил уведомления (User.telegramEnabled).
   */
  async enqueueToUser(
    userId: string | null | undefined,
    text: string,
    opts: EnqueueOptions = {},
    db: Db = this.prisma,
  ): Promise<void> {
    if (!userId) return;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { telegramChatId: true, telegramEnabled: true },
      });
      if (!user?.telegramChatId || !user.telegramEnabled) return;
      await this.enqueue(user.telegramChatId, text, opts, db);
    } catch (e) {
      this.logger.error(`Не удалось поставить личное сообщение Telegram (user=${userId})`, e as Error);
    }
  }
}
