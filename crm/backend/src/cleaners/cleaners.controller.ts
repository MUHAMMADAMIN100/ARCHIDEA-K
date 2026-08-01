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
import { Role } from '@prisma/client';
import { CleanersService } from './cleaners.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { managesOps, seesFinance } from '../common/permissions';

/** Ставка — это зарплата: из ответа её видит только тот, кому открыты финансы */
function withoutRate<T extends { rate?: number }>(row: T, user: AuthUser): T {
  if (seesFinance(user)) return row;
  const { rate: _rate, ...rest } = row;
  return rest as T;
}
import {
  CreateBrigadeDto,
  CreateCleanerDto,
  UpdateBrigadeDto,
  UpdateCleanerDto,
} from './dto/cleaner.dto';

/**
 * Клинеры и бригады.
 *
 * Состав команды ведут все сотрудники (право `ops:manage`): бригада — общая
 * сущность компании, «своих» клинеров у менеджера не бывает. А вот ставка
 * выплаты — это деньги, и менять её по-прежнему вправе только руководитель.
 */
@UseGuards(JwtAuthGuard)
@Controller('cleaners')
export class CleanersController {
  constructor(private service: CleanersService) {}

  private assertManages(user: AuthUser) {
    if (!managesOps(user)) {
      throw new ForbiddenException('Управление командой доступно сотрудникам компании');
    }
  }

  private assertRateAllowed(user: AuthUser, rate?: number) {
    if (rate === undefined) return;
    if (user.role !== Role.DIRECTOR) {
      throw new ForbiddenException(
        'Ставку выплаты может менять только руководитель',
      );
    }
  }

  /** activeOnly=true — для формы назначения на заказ (уволенных там быть не должно) */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const cleaners = await this.service.list(
      user,
      activeOnly === 'true' || activeOnly === '1',
    );
    return cleaners.map((c) => withoutRate(c, user));
  }

  @Get('team-tasks')
  teamTasks(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.service.teamTasksForDay(user, date);
  }

  // ответ на запись фильтруем так же, как список: иначе ставку было бы видно
  // в ответе на создание клинера, хотя в списке она вырезана
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateCleanerDto) {
    this.assertManages(user);
    this.assertRateAllowed(user, dto.rate);
    return withoutRate(await this.service.create(user, dto), user);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCleanerDto,
  ) {
    this.assertManages(user);
    this.assertRateAllowed(user, dto.rate);
    return withoutRate(await this.service.update(user, id, dto), user);
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

@UseGuards(JwtAuthGuard)
@Controller('brigades')
export class BrigadesController {
  constructor(private service: CleanersService) {}

  private assertManages(user: AuthUser) {
    if (!managesOps(user)) {
      throw new ForbiddenException('Управление бригадами доступно сотрудникам компании');
    }
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const brigades = await this.service.listBrigades();
    return brigades.map((b) => ({
      ...b,
      cleaners: b.cleaners.map((c) => withoutRate(c, user)),
    }));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBrigadeDto) {
    this.assertManages(user);
    return this.service.createBrigade(dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBrigadeDto,
  ) {
    this.assertManages(user);
    return this.service.updateBrigade(id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertManages(user);
    return this.service.removeBrigade(id);
  }
}
