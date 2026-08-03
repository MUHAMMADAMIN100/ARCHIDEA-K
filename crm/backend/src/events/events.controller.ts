import { Controller, Header, Sse, UseGuards } from '@nestjs/common';
import { interval, map, merge, Observable, startWith } from 'rxjs';
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
    const changes = this.events.changes.pipe(
      map((e) => ({
        data: JSON.stringify({
          id: e.id,
          resource: e.resource,
          mine: e.actorId === user.id,
        }),
      })),
    );

    /*
     * Пульс раз в 20 секунд.
     *
     * Две задачи. Первая: посредники (Vercel, Railway) закрывают соединение,
     * по которому долго ничего не шло, — и вкладка оставалась без изменений,
     * сама того не зная. Вторая: по пульсу вкладка понимает, что канал жив.
     * Молчание дольше сорока пяти секунд означает обрыв, и она переподключается,
     * не дожидаясь, пока человек заметит, что данные устарели.
     *
     * Первый пульс уходит сразу: он же подтверждает, что поток открылся.
     */
    const beat = interval(20_000).pipe(
      startWith(0),
      map(() => ({ data: JSON.stringify({ ping: 1 }) })),
    );

    return merge(changes, beat);
  }
}
