import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { ChangeBroadcastInterceptor } from './change-broadcast.interceptor';
import { EventsGateway } from './events.gateway';
import { JwtModule } from '@nestjs/jwt';
import { JWT_SECRET } from '../auth/jwt-secret';

/**
 * Живой канал изменений доступен всем модулям: перехватчик объявляет
 * событие сам, поэтому подключать сервис в каждом разделе не нужно.
 */
@Global()
@Module({
  imports: [JwtModule.register({ secret: JWT_SECRET })],
  providers: [EventsService, ChangeBroadcastInterceptor, EventsGateway],
  controllers: [EventsController],
  exports: [EventsService, ChangeBroadcastInterceptor],
})
export class EventsModule {}
