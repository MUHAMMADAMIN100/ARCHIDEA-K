import { Controller, Header, Sse, UseGuards } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/** Сообщение потока в том виде, в каком его ждёт браузер */
interface SseMessage {
  data: string;
}

@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private events: EventsService) {}

  /**
   * Поток изменений. Браузер держит одно соединение и получает короткие
   * сообщения вида {"resource":"orders"} — этого хватает, чтобы обновить
   * нужный экран.
   *
   * Своё же изменение пропускаем: экран автора уже обновлён оптимистично,
   * а лишний перезапрос сбрасывал бы наполовину заполненную форму.
   */
  /*
   * X-Accel-Buffering: no — просьба к промежуточным прокси не копить поток
   * в буфере. Без неё события доходили бы пачками с задержкой.
   */
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Sse()
  stream(@CurrentUser() user: AuthUser): Observable<SseMessage> {
    return this.events.changes.pipe(
      map((e) => ({
        data: JSON.stringify({
          resource: e.resource,
          mine: e.actorId === user.id,
        }),
      })),
    );
  }
}
