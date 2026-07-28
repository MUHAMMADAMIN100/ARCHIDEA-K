import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { FinanceModule } from '../finance/finance.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  // Финансы — автодоход при переходе заказа в «Оплачено» (ТЗ 7.1),
  // Telegram — уведомление о предпочтениях клиента (ТЗ 10.2)
  imports: [FinanceModule, TelegramModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
