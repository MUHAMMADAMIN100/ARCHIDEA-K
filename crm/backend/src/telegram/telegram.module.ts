import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramWorker } from './telegram.worker';
import { TelegramController } from './telegram.controller';

/**
 * Уведомления в Telegram (ТЗ 10.2).
 *
 * Модуль глобальный: очередь Telegram нужна почти всем бизнес-модулям
 * (заказы, напоминания, чек-листы, КП, смены), тянуть импорт в каждый — шум.
 */
@Global()
@Module({
  providers: [TelegramService, TelegramWorker],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
