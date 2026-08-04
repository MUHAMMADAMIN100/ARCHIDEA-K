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
import { FunnelStage } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PlanService } from './plan.service';
import {
  AssignCleanersDto,
  ChangeStageDto,
  CreateOrderDto,
  UpdateOrderDto,
} from './dto/order.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private service: OrdersService,
    private plan: PlanService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('stage') stage?: FunnelStage,
    @Query('managerId') managerId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list(user, { stage, managerId, search });
  }

  @Get('board')
  board(@CurrentUser() user: AuthUser) {
    return this.service.board(user);
  }

  /**
   * Архив этапа: закрытые заказы старше 45 дней.
   *
   * Стоит ВЫШЕ маршрута ':id' — иначе слово archive попало бы в него как
   * идентификатор заказа и вернуло «не найдено».
   */
  @Get('archive')
  archive(
    @CurrentUser() user: AuthUser,
    @Query('stage') stage: FunnelStage,
  ) {
    return this.service.archive(user, stage);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Patch(':id/stage')
  changeStage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeStageDto,
  ) {
    return this.service.changeStage(user, id, dto);
  }

  @Patch(':id/cleaners')
  assignCleaners(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignCleanersDto,
  ) {
    return this.service.assignCleaners(user, id, dto);
  }

  /** Удаление переносит заказ в корзину (ТЗ 6), а не стирает его */
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.service.remove(user, id, reason);
  }

  /**
   * План производства работ и срок (ТЗ: планирование).
   *
   * Считается на лету из объёма, выработки услуги и числа людей — хранить
   * его нельзя: поменяли бригаду, а в сохранённом плане прежние сроки.
   */
  @Get(':id/plan')
  planOf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plan.forOrder(user, id);
  }

  /** История изменений заказа (ТЗ 2) */
  @Get(':id/history')
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.history(user, id);
  }
}
