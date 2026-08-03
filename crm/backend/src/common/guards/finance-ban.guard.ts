import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthUser } from '../decorators/current-user.decorator';
import { financeBanned } from '../permissions';

/**
 * Персональный запрет на деньги — на стороне API.
 *
 * Закрывает разделы, которые менеджеру по работе НУЖНЫ (платёжные ведомости),
 * а сотруднику с галочкой «без доступа к финансам» — нет. Поэтому проверка
 * своя, а не общий NoOpsFinanceGuard: тот закрыл бы ведомости всем менеджерам
 * компании разом.
 *
 * В интерфейсе раздел и так скрыт, но без этого guard'а он открывается прямым
 * запросом к серверу.
 */
@Injectable()
export class FinanceBanGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) return true; // авторизацию проверяет JwtAuthGuard
    if (financeBanned(user)) {
      throw new ForbiddenException('Нет доступа к финансовым разделам');
    }
    return true;
  }
}
