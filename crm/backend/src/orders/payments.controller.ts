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
 * FinanceBanGuard здесь НАМЕРЕННО нет (решение владельца): принять оплату и
 * записать её в карточку заказа — работа того, кто ведёт клиента, а не
 * бухгалтерия. Ибодат с запретом «без доступа к финансам» вносит оплату,
 * строка в книге доходов создаётся сама — но саму книгу (раздел «Финансы»,
 * зарплаты, ведомости) запрет закрывает как и прежде: там стоят свои замки.
 * Доступ к заказу проверяет сервис — менеджер работает только со своими.
 */
@UseGuards(JwtAuthGuard)
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
