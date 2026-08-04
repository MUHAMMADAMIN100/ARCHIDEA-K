import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { SegmentsService } from './segments.service';
import { SegmentsController } from './segments.controller';
import { FinanceModule } from '../finance/finance.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ReportsModule } from '../reports/reports.module';
import { PayrollModule } from '../payroll/payroll.module';

@Module({
  // Финансы — автодоход при переходе заказа в «Оплачено» (ТЗ 7.1),
  // Telegram — уведомление о предпочтениях клиента (ТЗ 10.2)
  // Финансы — автодоход при переходе в «Оплачено» (ТЗ 7.1),
  // Telegram — уведомление о предпочтениях клиента (ТЗ 10.2),
  // Отчёты — черновик платёжной ведомости по оплаченному заказу
  // Выезды — автоматический выезд бригады на этапе «Осмотр объекта»
  imports: [FinanceModule, TelegramModule, ReportsModule, PayrollModule],
  providers: [OrdersService, PaymentsService, SegmentsService],
  controllers: [OrdersController, PaymentsController, SegmentsController],
  exports: [OrdersService],
})
export class OrdersModule {}
