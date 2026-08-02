import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthUser } from '../decorators/current-user.decorator';
import { can } from '../permissions';

/**
 * Запрет финансовых разделов на стороне API.
 *
 * В интерфейсе они и так скрыты, но без этого guard'а запрет обходится
 * прямым запросом к серверу.
 *
 * Кого закрывает: сотрудника без права `finance:view` — то есть менеджера,
 * а также руководителя с персональной галочкой «без доступа к финансам»
 * (она сильнее роли, см. permissions.ts).
 */
@Injectable()
export class NoOpsFinanceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) return true; // авторизацию проверяет JwtAuthGuard

    /*
     * Единственный источник правды — permissionsOf(): она уже учитывает и
     * роль, и персональный запрет noFinance. Повторять её условия здесь
     * значило бы завести второе правило, которое рано или поздно разойдётся
     * с первым — и один раздел закроется, а соседний останется открытым.
     */
    if (!can(user, 'finance:view')) {
      throw new ForbiddenException('Нет доступа к финансовым разделам');
    }
    return true;
  }
}
