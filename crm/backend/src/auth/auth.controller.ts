import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

const COOKIE_NAME = 'access_token';

/**
 * Флаги cookie:
 * - httpOnly — JS её не читает (недоступна для XSS)
 * - secure — только по HTTPS
 * - sameSite=lax — браузер НЕ шлёт её при запросах со сторонних сайтов,
 *   это и закрывает CSRF. Работает, потому что CRM обращается к API через
 *   свой же домен (/api проксируется на Railway), т.е. запрос first-party.
 */
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * IP клиента для журнала входов. Берём req.ip (вычислен Express с учётом
 * trust proxy) — его нельзя подделать заголовком. Левый элемент
 * X-Forwarded-For использовать НЕЛЬЗЯ: атакующий им управляет и отравил бы
 * журнал подставными адресами.
 */
function clientIp(req: Request): string | undefined {
  return req.ip ?? undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // Защита от подбора: не более 8 попыток входа за минуту с одного IP.
  // Плюс блокировка конкретного аккаунта на 15 минут после 5 неудач.
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user, maxAge } = await this.auth.login(dto, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, maxAge });
    // токен НЕ возвращаем в теле — авторизация только через httpOnly-cookie
    return { user };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
    return { ok: true };
  }

  /** Выйти со всех устройств — гасит все ранее выданные токены */
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.revokeAllSessions(user.id);
    res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
    return { ok: true };
  }

  /**
   * Одноразовый билет для живого канала.
   *
   * Сокет открывается напрямую к серверу приложения, а кука выдана на
   * домен CRM и на чужой домен не отправляется. Поэтому вкладка берёт
   * билет обычным запросом — здесь кука работает — и предъявляет его
   * сокету. Билет живёт минуту и годится только для этого.
   */
  @UseGuards(JwtAuthGuard)
  @Post('ws-ticket')
  wsTicket(@CurrentUser() user: AuthUser) {
    return this.auth.issueWsTicket(user.id);
  }

  /**
   * Кто я — и заодно продление сессии.
   *
   * CRM спрашивает это при каждом открытии, поэтому здесь же обновляем куку
   * ещё на 90 дней: работающий сотрудник пароль больше не вводит. Если
   * продлить не вышло (сотрудника отключили, сессию отозвали), просто
   * отвечаем как раньше — доступ снимет обычная проверка на следующем шаге.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fresh = await this.auth.refreshSession(user.id);
    if (fresh) {
      res.cookie(COOKIE_NAME, fresh.token, {
        ...COOKIE_OPTS,
        maxAge: fresh.maxAge,
      });
    }
    return user;
  }

  /** Журнал входов и попыток подбора — только руководителю */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR)
  @Get('login-attempts')
  attempts(@Query('limit') limit?: string) {
    return this.auth.loginAttempts(Number(limit) || 100);
  }
}
