import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { RemindersScheduler } from './reminders.scheduler';

/**
 * Напоминания перезвонить клиенту — предзаказ (ТЗ 10.1).
 *
 * Экспортирует RemindersService: заказы (10.2, `POST /orders/:id/follow-up`)
 * внедряют его, чтобы создать Reminder(source=PREORDER) прямо из карточки заказа.
 */
@Module({
  providers: [RemindersService, RemindersScheduler],
  controllers: [RemindersController],
  exports: [RemindersService],
})
export class RemindersModule {}
