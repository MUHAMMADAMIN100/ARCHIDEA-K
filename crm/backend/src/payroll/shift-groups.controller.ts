import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ShiftGroupStatus } from '@prisma/client';
import { ShiftGroupsService } from './shift-groups.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { managesOps, seesFinance } from '../common/permissions';
import {
  CloseShiftGroupDto,
  CreateShiftGroupDto,
  UpdateShiftGroupDto,
} from './dto/shift-group.dto';

/**
 * Выезды бригад на объекты (ТЗ 4): куда, когда и с кем ездили.
 *
 * Состав выезда и адрес — операционные данные, они нужны и логисту, и отделу
 * продаж, поэтому вести выезды может любой сотрудник (право `ops:manage`).
 *
 * Ставки участников сотрудник видит: по этому же составу он потом составляет
 * платёжную ведомость, а она вся и есть «кому сколько заплатить». Закрыты
 * не отдельные ставки, а сводные деньги компании — выплаты за период,
 * штрафы, премии и выручка (см. permissions.ts).
 */
@UseGuards(JwtAuthGuard)
@Controller('shift-groups')
export class ShiftGroupsController {
  constructor(private service: ShiftGroupsService) {}

  private assertManages(user: AuthUser) {
    if (!managesOps(user)) {
      throw new ForbiddenException('Управление выездами доступно сотрудникам компании');
    }
  }

  @Get()
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: ShiftGroupStatus,
    @Query('orderId') orderId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list({ from, to, status, orderId, search });
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShiftGroupDto) {
    this.assertManages(user);
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateShiftGroupDto,
  ) {
    this.assertManages(user);
    return this.service.update(user, id, dto);
  }

  /** Закрытие выезда: архивный слепок + начисление смен участникам */
  @Post(':id/close')
  close(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CloseShiftGroupDto,
  ) {
    this.assertManages(user);
    return this.service.close(user, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    this.assertManages(user);
    return this.service.remove(user, id, reason);
  }
}
