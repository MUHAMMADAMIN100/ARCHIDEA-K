import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { ChangeBroadcastInterceptor } from './change-broadcast.interceptor';

/**
 * Живой канал изменений доступен всем модулям: перехватчик объявляет
 * событие сам, поэтому подключать сервис в каждом разделе не нужно.
 */
@Global()
@Module({
  providers: [EventsService, ChangeBroadcastInterceptor],
  controllers: [EventsController],
  exports: [EventsService, ChangeBroadcastInterceptor],
})
export class EventsModule {}
