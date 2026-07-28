import { Controller, Delete, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** Личная привязка Telegram сотрудника (chatId вносит директор в карточке пользователя) */
@UseGuards(JwtAuthGuard)
@Controller('telegram')
export class TelegramController {
  constructor(private prisma: PrismaService) {}

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { telegramChatId: true, telegramEnabled: true },
    });
    return {
      linked: Boolean(me?.telegramChatId),
      chatId: me?.telegramChatId ?? null,
      enabled: me?.telegramEnabled ?? true,
    };
  }

  /** Отвязать свой личный чат — личные уведомления перестают приходить */
  @Delete('link')
  async unlink(@CurrentUser() user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: null },
    });
    return { ok: true };
  }
}
