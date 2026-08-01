import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { managesOps } from '../common/permissions';
import { CreateFineDto, MarkDayDto } from './dto/payroll.dto';

/**
 * Смены, штрафы и выплаты.
 *
 * Раздел разделён по смыслу, а не одним общим запретом:
 *  - отметка смен (кто в какой день работал) — операционные данные, их ведёт
 *    руководство целиком, включая операционного управляющего;
 *  - сводка выплат и штрафы — это зарплатный фонд и ставки всех клинеров,
 *    поэтому только руководитель.
 *
 * Раньше на весь контроллер стоял единственный NoOpsFinanceGuard, который
 * закрывает доступ ТОЛЬКО операционному управляющему. Рядовой менеджер
 * (маркетолог, логист) проходил его насквозь и видел зарплаты всей компании,
 * а также мог выписать или снять штраф.
 */
@UseGuards(JwtAuthGuard)
@Controller('payroll')
export class PayrollController {
  constructor(private service: PayrollService) {}

  /** Деньги: ставки, начисления, штрафы — только руководитель */
  private assertMoney(user: AuthUser) {
    if (user.role !== Role.DIRECTOR) {
      throw new ForbiddenException(
        'Выплаты и штрафы доступны только руководителю',
      );
    }
  }

  /** Операционные данные по сменам — любой сотрудник компании */
  private assertOps(user: AuthUser) {
    if (!managesOps(user)) {
      throw new ForbiddenException('Учёт смен доступен сотрудникам компании');
    }
  }

  @Get()
  summary(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    this.assertMoney(user);
    return this.service.summary(from, to);
  }

  /**
   * Отметки смен: кто в какой день работал и по какой ставке.
   *
   * Это операционные данные — на них сотрудник опирается, когда составляет
   * платёжную ведомость. Закрыта не отдельная смена, а СВОДКА выплат за
   * период (метод summary выше) — то есть зарплатный фонд компании целиком.
   */
  @Get('shifts')
  listShifts(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cleanerId') cleanerId?: string,
  ) {
    this.assertOps(user);
    return this.service.listShifts(from, to, cleanerId);
  }

  @Post('shifts/day')
  markDay(@CurrentUser() user: AuthUser, @Body() dto: MarkDayDto) {
    this.assertOps(user);
    return this.service.markDay(user, dto);
  }

  @Delete('shifts/:id')
  removeShift(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertOps(user);
    return this.service.removeShift(user, id);
  }

  @Get('fines')
  listFines(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cleanerId') cleanerId?: string,
  ) {
    this.assertMoney(user);
    return this.service.listFines(from, to, cleanerId);
  }

  @Post('fines')
  createFine(@CurrentUser() user: AuthUser, @Body() dto: CreateFineDto) {
    this.assertMoney(user);
    return this.service.createFine(user, dto);
  }

  @Delete('fines/:id')
  removeFine(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertMoney(user);
    return this.service.removeFine(user, id);
  }
}
