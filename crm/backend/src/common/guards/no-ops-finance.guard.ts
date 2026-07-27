import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * Запрет финансовых разделов для ops-менеджера.
 *
 * Уровень доступа canManageOps даёт видимость всей компании (клиенты, заказы,
 * команда, задачи, аналитика), но БЕЗ денег: смены и выплаты, отчёты, тарифы,
 * выручка. В интерфейсе эти разделы скрыты — этот guard закрывает их и на
 * стороне API, иначе запрет обходится прямым запросом к серверу.
 *
 * Директор проходит всегда; обычный менеджер — тоже (он видит только свои
 * данные, это отдельный слой проверок внутри сервисов).
 */
@Injectable()
export class NoOpsFinanceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) return true; // авторизацию проверяет JwtAuthGuard

    const isOps = user.role !== Role.DIRECTOR && user.canManageOps === true;
    if (isOps) {
      throw new ForbiddenException('Нет доступа к финансовым разделам');
    }
    return true;
  }
}
