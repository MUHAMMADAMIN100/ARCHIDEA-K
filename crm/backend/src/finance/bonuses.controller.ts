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
import { BonusesService } from './bonuses.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NoOpsFinanceGuard } from '../common/guards/no-ops-finance.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateBonusDto, ListBonusDto, UpdateBonusDto } from './dto/bonus.dto';

/** Премии клинерам и сотрудникам CRM — только ручное начисление (ТЗ 7.2) */
@Controller('bonuses')
@UseGuards(JwtAuthGuard, NoOpsFinanceGuard)
export class BonusesController {
  constructor(private service: BonusesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListBonusDto) {
    return this.service.list(user, q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBonusDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBonusDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/pay')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.pay(user, id);
  }

  /** Удаление переносит премию (и связанный расход) в корзину (ТЗ 6) */
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.service.remove(user, id, reason);
  }
}
