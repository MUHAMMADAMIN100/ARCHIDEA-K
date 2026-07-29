import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { FinanceModule } from '../finance/finance.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  // Финансы — автодоход при переходе заказа в «Оплачено» (ТЗ 7.1),
  // Telegram — уведомление о предпочтениях клиента (ТЗ 10.2)
  // Финансы — автодоход при переходе в «Оплачено» (ТЗ 7.1),
  // Telegram — уведомление о предпочтениях клиента (ТЗ 10.2),
  // Отчёты — черновик платёжной ведомости по оплаченному заказу
  imports: [FinanceModule, TelegramModule, ReportsModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
