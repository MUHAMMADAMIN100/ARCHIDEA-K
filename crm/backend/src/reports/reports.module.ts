import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [NotificationsModule],
  providers: [ReportsService],
  controllers: [ReportsController],
  // заказы создают черновик ведомости при переходе в «Оплачено»
  exports: [ReportsService],
})
export class ReportsModule {}
