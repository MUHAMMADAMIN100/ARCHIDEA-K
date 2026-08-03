import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { escapeHtml } from './telegram.util';
import { NOT_DELETED } from '../common/soft-delete';
import { formatDate } from '../common/time/dushanbe';

/**
 * Приём сообщений от бота.
 *
 * Зачем понадобился: раньше бот умел только отправлять, а chat_id сотрудника
 * руководитель вносил в его карточку руками — приходилось спрашивать номер у
 * каждого. Теперь сотрудник жмёт кнопку в своём профиле, получает ссылку с
 * одноразовым кодом, нажимает «Старт» — и бот привязывается сам.
 *
 * Почему опрос, а не webhook: webhook требует зарегистрировать публичный
 * адрес и держать его в настройках. Опрос не требует ничего: заработал сразу
 * после появления токена, переживает смену домена и локальный запуск.
 * Нагрузка мизерная — одно ожидающее соединение.
 */

/*
 * Кнопок у бота больше нет (решение владельца).
 *
 * Были три: «Что у меня сегодня», «Мои напоминания», «Отключить
 * уведомления». Бот должен работать сам — рассылать заявки, задачи и
 * напоминания, — а не быть вторым интерфейсом рядом с CRM. Отключить
 * уведомления можно в своём профиле в CRM, там же, где Telegram
 * подключали.
 */

/** Форма кода привязки: 9 случайных байт в base64url — ровно 12 символов */
const LINK_CODE = /^[A-Za-z0-9_-]{12}$/;

@Injectable()
export class TelegramBot implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TelegramBot');
  private offset = 0;
  private stopped = false;
  private username: string | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit(): void {
    if (!process.env.TELEGRAM_BOT_TOKEN) return; // без токена бота нет
    void this.loadUsername();
    void this.poll();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /** Имя бота нужно для ссылки t.me/…?start=код — берём у самого Telegram */
  async botUsername(): Promise<string | null> {
    if (this.username) return this.username;
    await this.loadUsername();
    return this.username;
  }

  private async loadUsername(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const body = (await res.json()) as {
        ok: boolean;
        result?: { username?: string };
      };
      if (body.ok && body.result?.username) this.username = body.result.username;
    } catch {
      // сеть подведёт — попробуем при следующем запросе ссылки
    }
  }

  /**
   * Цикл опроса. Ошибки не должны его останавливать: Telegram отвечает 409,
   * если рядом поднялся второй экземпляр (так бывает в момент деплоя), а сеть
   * иногда рвётся — в обоих случаях просто ждём и продолжаем.
   */
  private async poll(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    while (!this.stopped && token) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${this.offset}`,
          { signal: AbortSignal.timeout(40_000) },
        );
        const body = (await res.json()) as {
          ok: boolean;
          result?: { update_id: number; message?: TgMessage }[];
        };
        if (!body.ok) {
          await sleep(5000);
          continue;
        }
        for (const u of body.result ?? []) {
          this.offset = u.update_id + 1;
          if (u.message) await this.handle(u.message).catch((e) => {
            this.log.warn(`Сообщение не обработано: ${String(e)}`);
          });
        }
      } catch {
        await sleep(5000);
      }
    }
  }

  private async handle(msg: TgMessage): Promise<void> {
    const chatId = String(msg.chat?.id ?? '');
    const text = (msg.text ?? '').trim();
    if (!chatId || !text) return;

    const name = [msg.from?.first_name, msg.from?.last_name]
      .filter(Boolean)
      .join(' ');

    if (text.startsWith('/start')) {
      const code = text.slice('/start'.length).trim();
      return this.start(chatId, code, name || msg.from?.username || null);
    }

    const user = await this.prisma.user.findFirst({
      where: { telegramChatId: chatId, ...NOT_DELETED },
      select: { id: true, fullName: true, telegramEnabled: true },
    });
    if (!user) {
      /*
       * Код, присланный отдельным сообщением, — тот же «Старт», только руками.
       * Он нужен там, где ссылки t.me не открываются (у части провайдеров
       * домен не разрешается в DNS): сотрудник находит бота поиском и
       * присылает код из профиля. Форму строки проверяем, чтобы обычное
       * «привет» не превращалось в «ссылка устарела».
       */
      if (LINK_CODE.test(text)) {
        return this.start(chatId, text, name || msg.from?.username || null);
      }
      return this.say(
        chatId,
        'Этот чат не подключён к CRM. Откройте свой профиль в CRM, нажмите ' +
          '«Подключить Telegram» и пришлите сюда код из профиля.',
      );
    }

    /*
     * Любое сообщение от подключённого сотрудника: бот только рассылает,
     * отвечать ему нечем. Говорим об этом прямо, чтобы человек не ждал
     * ответа и не искал кнопки, которых нет.
     */
    return this.say(
      chatId,
      `${user.fullName}, бот присылает вам новые заявки, задачи и напоминания. ` +
        'Отвечать здесь не нужно — вся работа в CRM.',
    );
  }

  /** /start с кодом — привязываем чат к сотруднику */
  private async start(
    chatId: string,
    code: string,
    name: string | null,
  ): Promise<void> {
    if (!code) {
      return this.say(
        chatId,
        'Это бот CRM «Архидея». Чтобы получать уведомления, откройте свой ' +
          'профиль в CRM, нажмите «Подключить Telegram» и пришлите сюда код ' +
          'из профиля — одним сообщением.',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        telegramLinkCode: code,
        telegramLinkExpires: { gt: new Date() },
        ...NOT_DELETED,
      },
      select: { id: true, fullName: true },
    });
    if (!user) {
      return this.say(
        chatId,
        'Код устарел или уже использован. Откройте профиль в CRM и ' +
          'нажмите «Подключить Telegram» ещё раз.',
      );
    }

    /*
     * Один чат — один сотрудник. Если этот же Telegram был привязан к другому
     * человеку, старую привязку снимаем: иначе уведомления двоих приходили бы
     * в один чат и было бы непонятно, кому они адресованы.
     */
    await this.prisma.user.updateMany({
      where: { telegramChatId: chatId, NOT: { id: user.id } },
      data: { telegramChatId: null, telegramName: null },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: chatId,
        telegramName: name,
        telegramEnabled: true,
        telegramLinkCode: null,
        telegramLinkExpires: null,
      },
    });

    await this.say(
      chatId,
      `Здравствуйте, ${escapeHtml(user.fullName)}. Бот подключён к CRM «Архидея».\n\n` +
        'Сюда будут приходить новые заявки, задачи и напоминания о звонках. ' +
        'Отвечать боту не нужно — вся работа в CRM.',
    );
  }

  /*
   * Сводки «что у меня сегодня» и «мои напоминания» убраны вместе с кнопками:
   * они дублировали календарь и раздел напоминаний в CRM, а бот теперь только
   * рассылает.
   */

  /**
   * Ответ ботом — напрямую, минуя очередь.
   *
   * Очередь существует для деловых уведомлений: они не должны потеряться при
   * перезапуске. Ответ на сообщение — другое дело: он нужен сейчас, а если не
   * дошёл, человек напишет ещё раз.
   *
   * Клавиатуры нет: бот только рассылает, а кнопки под полем ввода делали его
   * вторым интерфейсом рядом с CRM.
   */
  private async say(chatId: string, text: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          // снимаем клавиатуру, если она осталась с прошлых версий
          reply_markup: { remove_keyboard: true },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.log.warn(`Ответ боту не доставлен: ${String(e)}`);
    }
  }
}

interface TgMessage {
  chat?: { id?: number | string };
  text?: string;
  from?: { first_name?: string; last_name?: string; username?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
