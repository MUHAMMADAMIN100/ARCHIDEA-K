import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';

/** История изменений (ТЗ 2) */
@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private service: AuditService) {}

  /** Общая лента. Финансовые записи скрыты от тех, у кого нет доступа к финансам. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: AuditQueryDto) {
    if (!can(user, 'audit:view')) {
      throw new ForbiddenException('Журнал изменений доступен руководству');
    }
    return this.service.list(user, q);
  }
}
