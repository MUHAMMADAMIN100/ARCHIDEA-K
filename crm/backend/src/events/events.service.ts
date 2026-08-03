import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

/** Что изменилось: раздел данных, по которому нужно обновить экраны */
export type ChangedResource =
  | 'orders'
  | 'clients'
  | 'tasks'
  | 'shift-groups'
  | 'payroll'
  | 'finance'
  | 'reports'
  | 'proposals'
  | 'reminders'
  | 'checklists'
  | 'tariffs'
  | 'users'
  | 'cleaners'
  | 'brigades'
  | 'notifications'
  | 'trash';

export interface ChangeEvent {
  /**
   * Номер события с момента запуска сервера.
   *
   * Вкладка держит сразу два канала — сокет и поток, — и одно и то же
   * изменение приходит по обоим. По номеру второе сообщение отбрасывается,
   * иначе каждое чужое действие вызывало бы два запроса за данными.
   */
  id: number;
  resource: ChangedResource;
  /** Кто вызвал изменение — свой же экран может его пропустить */
  actorId?: string;
}

/**
 * Живой канал изменений.
 *
 * Сервер сообщает браузерам, что раздел данных поменялся, — и экраны
 * обновляются сразу, без опроса каждые пятнадцать секунд. Событие
 * намеренно лёгкое: только название раздела, без самих данных. Так не
 * нужно повторять на каждом изменении правила доступа (менеджер видит
 * свои заказы, руководитель — все): браузер просто перезапрашивает то,
 * что ему и так разрешено.
 */
@Injectable()
export class EventsService {
  private readonly stream = new Subject<ChangeEvent>();
  private seq = 0;

  /** Поток для подписки (см. EventsController) */
  get changes() {
    return this.stream.asObservable();
  }

  publish(resource: ChangedResource, actorId?: string): void {
    this.seq += 1;
    this.stream.next({ id: this.seq, resource, actorId });
  }
}
