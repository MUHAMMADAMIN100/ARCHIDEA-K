import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NoOpsFinanceGuard } from '../common/guards/no-ops-finance.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

/** Смены, штрафы и выплаты. Доступ: руководитель и управляющий (менеджер). */
@UseGuards(JwtAuthGuard, NoOpsFinanceGuard)
@Controller('payroll')
export class PayrollController {
  constructor(private service: PayrollService) {}

  @Get()
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.summary(from, to);
  }

  @Get('shifts')
  listShifts(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.listShifts(from, to);
  }

  @Post('shifts/day')
  markDay(
    @Body()
    body: {
      date: string;
      cleanerIds: string[];
      baseline?: string[];
      note?: string;
    },
  ) {
    return this.service.markDay(body);
  }

  @Delete('shifts/:id')
  removeShift(@Param('id') id: string) {
    return this.service.removeShift(id);
  }

  @Get('fines')
  listFines(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cleanerId') cleanerId?: string,
  ) {
    return this.service.listFines(from, to, cleanerId);
  }

  @Post('fines')
  createFine(
    @CurrentUser() user: AuthUser,
    @Body()
    body: { cleanerId: string; amount: number; reason: string; date?: string },
  ) {
    return this.service.createFine(user, body);
  }

  @Delete('fines/:id')
  removeFine(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeFine(user, id);
  }
}
