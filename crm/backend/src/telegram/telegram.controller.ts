import { Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramBot } from './telegram.bot';

/** Код привязки живёт сутки: за это время сотрудник успеет открыть Telegram */
const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Личная привязка Telegram.
 *
 * Подключает себя сам сотрудник: chat_id больше ни у кого не спрашивают.
 * Кнопка в профиле выдаёт ссылку с одноразовым кодом, «Старт» у бота
 * завершает привязку (см. telegram.bot.ts).
 */
@UseGuards(JwtAuthGuard)
@Controller('telegram')
export class TelegramController {
  constructor(
    private prisma: PrismaService,
    private bot: TelegramBot,
  ) {}

  /**
   * Данные для подключения: одноразовый код, имя бота и две ссылки.
   *
   * Ссылок две, потому что t.me открывается не у всех: у части провайдеров
   * Таджикистана домен не разрешается в DNS, и браузер показывает «Не удаётся
   * получить доступ к сайту». Само приложение Telegram при этом работает —
   * поэтому основной путь теперь tg://resolve, его обрабатывает установленная
   * программа, без обращения к сети. Код отдаём отдельно: даже без обеих
   * ссылок сотрудник может открыть бота поиском и отправить код сообщением.
   */
  @Post('link')
  async link(@CurrentUser() user: AuthUser) {
    const username = await this.bot.botUsername();
    if (!username) {
      return {
        ok: false,
        message:
          'Бот не настроен: у сервера нет токена Telegram. Обратитесь к администратору.',
      };
    }
    const code = randomBytes(9).toString('base64url');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        telegramLinkCode: code,
        telegramLinkExpires: new Date(Date.now() + LINK_TTL_MS),
      },
    });
    return {
      ok: true,
      bot: username,
      code,
      deepLink: `tg://resolve?domain=${username}&start=${code}`,
      url: `https://t.me/${username}?start=${code}`,
    };
  }

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { telegramChatId: true, telegramEnabled: true, telegramName: true },
    });
    return {
      linked: Boolean(me?.telegramChatId),
      chatId: me?.telegramChatId ?? null,
      name: me?.telegramName ?? null,
      enabled: me?.telegramEnabled ?? true,
    };
  }

  /** Отвязать свой личный чат — личные уведомления перестают приходить */
  @Delete('link')
  async unlink(@CurrentUser() user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: null, telegramName: null },
    });
    return { ok: true };
  }
}
