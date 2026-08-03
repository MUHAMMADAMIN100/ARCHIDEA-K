import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReportsService, ReportInput } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { FinanceBanGuard } from '../common/guards/finance-ban.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

/**
 * Платёжные ведомости (отчёты менеджеров основателю).
 *
 * Раздел открыт каждому сотруднику, но `ReportsService.scope()` показывает
 * не-руководителю ТОЛЬКО его собственные ведомости — свою он и составляет.
 * Общего доступа к чужим выплатам здесь нет, поэтому общий финансовый запрет
 * на весь контроллер не нужен: он лишь отбирал у операционного управляющего
 * его же ведомости.
 *
 * FinanceBanGuard — другое дело: это персональная галочка «без доступа к
 * финансам». В ведомости стоят и цена заказа, и выплаты работникам, поэтому
 * сотруднику, которому владелец закрыл деньги, раздел закрыт целиком.
 */
@UseGuards(JwtAuthGuard, FinanceBanGuard)
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: ReportInput) {
    return this.service.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ReportInput,
  ) {
    return this.service.update(user, id, body);
  }

  @Post(':id/send')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.send(user, id);
  }

  @Post(':id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.accept(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
