import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

/** Методы, которые что-то меняют — только их и проверяем */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Защита от CSRF по источнику запроса.
 *
 * Основной барьер — cookie с SameSite=Lax (браузер не отправит её со
 * стороннего сайта). Этот guard — второй рубеж: даже если браузер старый
 * или SameSite обойдён, изменяющий запрос с чужого Origin будет отклонён.
 *
 * Запросы без Origin/Referer (curl, мобильные приложения, серверные
 * интеграции) не блокируем — у них нет браузерной cookie-сессии, и
 * подделать её со стороннего сайта невозможно.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowed: string[];

  constructor() {
    this.allowed = [
      process.env.FRONTEND_URL,
      process.env.LANDING_URL,
      'http://localhost:5173',
      'http://localhost:5174',
    ].filter((o): o is string => Boolean(o));
  }

  private isAllowed(value: string): boolean {
    let origin: string;
    try {
      origin = new URL(value).origin;
    } catch {
      return false;
    }
    return this.allowed.some((a) => {
      try {
        return new URL(a).origin === origin;
      } catch {
        return false;
      }
    });
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(req.method)) return true;

    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const source = origin || referer;

    // нет браузерного источника — значит и cookie подставить некому
    if (!source) return true;

    if (!this.isAllowed(source)) {
      throw new ForbiddenException('Запрос с недоверенного источника');
    }
    return true;
  }
}
