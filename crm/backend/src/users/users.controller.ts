import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private service: UsersService) {}

  // менеджеров видят оба (для назначения), полный список — только руководитель
  @Get('managers')
  managers() {
    return this.service.findManagers();
  }

  // сотрудники, которым можно ставить задачи (директор или ops-менеджер)
  @Get('assignable')
  assignable(@CurrentUser() user: AuthUser) {
    return this.service.assignable(user);
  }

  /*
   * Весь действующий штат — для выбора ОТВЕТСТВЕННОГО за клиента и заказ.
   * Открыт каждому сотруднику: передать заявку коллеге должен уметь любой,
   * а имя и должность коллеги секретом не являются.
   */
  @Get('staff')
  staff() {
    return this.service.staff();
  }

  @Roles(Role.DIRECTOR)
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles(Role.DIRECTOR)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto);
  }

  @Roles(Role.DIRECTOR)
  @Patch(':id/active')
  setActive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.service.setActive(id, isActive, user);
  }

  @Roles(Role.DIRECTOR)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }

  @Roles(Role.DIRECTOR)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.service.update(id, dto, user);
  }

  /** История изменений сотрудника (ТЗ 2) */
  @Roles(Role.DIRECTOR)
  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  /** Что этот сотрудник менял в системе (ТЗ 2) */
  @Roles(Role.DIRECTOR)
  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.service.activity(id);
  }

  /** Показатели сотрудника за период — для расчёта зарплаты */
  @Get(':id/analytics')
  periodAnalytics(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.periodAnalytics(user, id, from, to);
  }

  // Карточка сотрудника / профиль (руководитель — любой, сотрудник — себя)
  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user, id);
  }

  // Списки для боксов профиля
  @Get(':id/list/:type')
  getList(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('type') type: string,
  ) {
    return this.service.getList(user, id, type);
  }
}
