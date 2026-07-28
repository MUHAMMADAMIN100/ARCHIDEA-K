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
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NoOpsFinanceGuard } from '../common/guards/no-ops-finance.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateFinanceEntryDto,
  FinanceSummaryDto,
  ListFinanceEntryDto,
  UpdateFinanceEntryDto,
} from './dto/finance-entry.dto';

/**
 * Доходы и расходы (ТЗ 7.1). NoOpsFinanceGuard закрывает раздел от
 * ops-менеджера ещё на уровне маршрута; окончательная проверка (finance:view /
 * finance:manage) — внутри сервиса, там же, где решается доступ обычного
 * менеджера (у него этих прав нет вовсе).
 */
@Controller('finance')
@UseGuards(JwtAuthGuard, NoOpsFinanceGuard)
export class FinanceController {
  constructor(private service: FinanceService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListFinanceEntryDto) {
    return this.service.list(user, q);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() q: FinanceSummaryDto) {
    return this.service.summary(user, q);
  }

  @Get('categories')
  categories(@CurrentUser() user: AuthUser) {
    return this.service.categories(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFinanceEntryDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceEntryDto,
  ) {
    return this.service.update(user, id, dto);
  }

  /** Удаление переносит запись в корзину (ТЗ 6), а не стирает её */
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.service.remove(user, id, reason);
  }
}
