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
 * А вот ставки участников — деньги. Раньше они уезжали в браузер вместе с
 * составом группы, то есть зарплаты бригады видел кто угодно. Теперь суммы
 * вырезаются из ответа всем, у кого нет доступа к финансам.
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

  /**
   * Убирает из выезда чужие зарплаты для тех, кому финансы закрыты.
   *
   * Скрывается ставка ШТАТНОГО клинера — это его зарплата из справочника.
   * Выплата разовому клинеру (ТЗ 2) остаётся: её вводит руками тот же человек,
   * который заводит выезд, и она относится только к этому выезду. Если её
   * тоже вырезать, форма правки выезда вернёт пустое поле и молча обнулит
   * уже согласованную выплату замене.
   */
  private hideMoney<T extends Record<string, any>>(group: T, user: AuthUser): T {
    if (seesFinance(user)) return group;

    type MemberLike = {
      rate?: number;
      cleanerId?: string | null;
      isGuest?: boolean;
    };
    const stripStaffRate = <M extends MemberLike>(member: M): M => {
      const isGuest = member.isGuest === true || !member.cleanerId;
      if (isGuest) return member;
      const { rate: _rate, ...rest } = member;
      return rest as M;
    };

    const snapshot = group.closedSnapshot as
      | { members?: { cleanerId?: string | null; rate?: number }[] }
      | null
      | undefined;

    return {
      ...group,
      members: (group.members ?? []).map(stripStaffRate),
      // сам факт начисленных смен оставляем — по нему видно, что выезд закрыт
      shifts: (group.shifts ?? []).map(
        ({ rate: _rate, ...shift }: { rate?: number }) => shift,
      ),
      ...(snapshot?.members
        ? {
            closedSnapshot: {
              ...snapshot,
              members: snapshot.members.map(stripStaffRate),
            },
          }
        : {}),
    };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: ShiftGroupStatus,
    @Query('orderId') orderId?: string,
    @Query('search') search?: string,
  ) {
    const groups = await this.service.list({ from, to, status, orderId, search });
    return groups.map((g) => this.hideMoney(g, user));
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.hideMoney(await this.service.getOne(id), user);
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
