import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LoadService } from './load.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Загрузка бригад по дням (ТЗ: планирование).
 *
 * Открыт всем сотрудникам: расписание выездов — операционные данные, по ним
 * управляющий и менеджер решают, на какой день ставить новый объект.
 */
@UseGuards(JwtAuthGuard)
@Controller('brigade-load')
export class LoadController {
  constructor(private service: LoadService) {}

  @Get()
  byDays(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.byDays(user, from, to);
  }
}
