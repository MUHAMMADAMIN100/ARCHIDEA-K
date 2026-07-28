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
import { TariffsService } from './tariffs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';
import {
  CreateExtraDto,
  CreateTariffDto,
  UpdateExtraDto,
  UpdateTariffDto,
} from './dto/tariff.dto';

/**
 * Управление услугами (ТЗ 1.1).
 * Раньше можно было только менять цену; теперь директор заводит, правит,
 * скрывает и удаляет услуги целиком.
 */
@Controller('tariffs')
export class TariffsController {
  constructor(private service: TariffsService) {}

  /** Публично — калькулятор лендинга берёт отсюда актуальные цены */
  @Public()
  @Get()
  getAll() {
    return this.service.getAll();
  }

  /** Полный список для раздела «Услуги», включая скрытые */
  @UseGuards(JwtAuthGuard)
  @Get('manage')
  getAllForAdmin(@CurrentUser() user: AuthUser) {
    this.assertCanManage(user);
    return this.service.getAllForAdmin();
  }

  private assertCanManage(user: AuthUser) {
    if (!can(user, 'services:manage')) {
      throw new ForbiddenException('Управление услугами доступно руководителю');
    }
  }

  // ─────────────────── Услуги ───────────────────

  @UseGuards(JwtAuthGuard)
  @Post('tariff')
  createTariff(@CurrentUser() user: AuthUser, @Body() dto: CreateTariffDto) {
    this.assertCanManage(user);
    return this.service.createTariff(user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('tariff/:key')
  updateTariff(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body() dto: UpdateTariffDto,
  ) {
    this.assertCanManage(user);
    return this.service.updateTariff(user, key, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('tariff/:key')
  removeTariff(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query('reason') reason?: string,
  ) {
    this.assertCanManage(user);
    return this.service.removeTariff(user, key, reason);
  }

  // ───────────────── Доп. услуги ─────────────────

  @UseGuards(JwtAuthGuard)
  @Post('extra')
  createExtra(@CurrentUser() user: AuthUser, @Body() dto: CreateExtraDto) {
    this.assertCanManage(user);
    return this.service.createExtra(user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('extra/:key')
  updateExtra(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body() dto: UpdateExtraDto,
  ) {
    this.assertCanManage(user);
    return this.service.updateExtra(user, key, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('extra/:key')
  removeExtra(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query('reason') reason?: string,
  ) {
    this.assertCanManage(user);
    return this.service.removeExtra(user, key, reason);
  }

  /** История изменений услуги (ТЗ 2) */
  @UseGuards(JwtAuthGuard)
  @Get(':key/history')
  history(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    this.assertCanManage(user);
    return this.service.history(key);
  }
}
