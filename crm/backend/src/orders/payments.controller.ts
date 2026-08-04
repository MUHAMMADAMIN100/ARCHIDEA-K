import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { FinanceBanGuard } from '../common/guards/finance-ban.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Оплаты по заказу (ТЗ 3.1 и 3.2).
 *
 * Отдельный контроллер, а не пара методов в orders: у платежей своя история,
 * своя правка и своё удаление — в карточке заказа они живут списком.
 *
 * FinanceBanGuard здесь обязателен: взнос пишет строку в книгу доходов, а
 * персональный запрет на деньги сильнее роли. Без него сотрудник, которому
 * владелец закрыл финансы, правил бы выручку компании через карточку заказа —
 * то есть ровно то, что ему запрещено, только с другой стороны.
 */
@UseGuards(JwtAuthGuard, FinanceBanGuard)
@Controller('orders/:orderId/payments')
export class PaymentsController {
  constructor(private service: PaymentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.service.list(user, orderId);
  }

  /** Одна часть или сразу несколько — смешанная оплата */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.service.create(user, orderId, dto);
  }

  @Patch(':paymentId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.service.update(user, orderId, paymentId, dto);
  }

  @Delete(':paymentId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.service.remove(user, orderId, paymentId);
  }
}
