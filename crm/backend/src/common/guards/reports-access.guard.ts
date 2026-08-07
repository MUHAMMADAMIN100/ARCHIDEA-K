import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthUser } from '../decorators/current-user.decorator';
import { seesReports } from '../permissions';

/**
 * Доступ к платёжным ведомостям.
 *
 * Раньше здесь стоял общий запрет на финансы, и сотрудник с галочкой «без
 * доступа к финансам» терял ведомости целиком. Но ведомость — рабочий
 * документ: состав бригады, объект, выплаты за смену. Владелец захотел
 * открыть их конкретному человеку, не открывая ему книгу доходов компании,
 * — для этого есть персональная галочка «Ведомости», и она сильнее запрета.
 *
 * В интерфейсе раздел и так скрыт, но без этой проверки он открывается
 * прямым запросом к серверу.
 */
@Injectable()
export class ReportsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) return true; // авторизацию проверяет JwtAuthGuard
    if (!seesReports(user)) {
      throw new ForbiddenException(
        'Нет доступа к ведомостям. Открыть его может руководитель в карточке сотрудника',
      );
    }
    return true;
  }
}
