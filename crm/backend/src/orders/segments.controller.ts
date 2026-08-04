import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { SegmentsService } from './segments.service';
import { ReplaceSegmentsDto } from './dto/segment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Разбивка объекта в заказе (ТЗ: объём работ).
 *
 * Один PUT на всё дерево вместо набора точечных ручек: структура объекта
 * правится целиком, и промежуточные состояния никого не интересуют.
 */
@UseGuards(JwtAuthGuard)
@Controller('orders/:orderId/segments')
export class SegmentsController {
  constructor(private service: SegmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.service.list(user, orderId);
  }

  @Put()
  replace(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() dto: ReplaceSegmentsDto,
  ) {
    return this.service.replace(user, orderId, dto);
  }
}
