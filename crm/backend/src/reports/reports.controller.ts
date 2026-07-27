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
import { NoOpsFinanceGuard } from '../common/guards/no-ops-finance.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

/** Платёжные ведомости (отчёты менеджеров основателю) */
@UseGuards(JwtAuthGuard, NoOpsFinanceGuard)
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
