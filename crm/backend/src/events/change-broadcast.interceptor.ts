import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { ChangedResource, EventsService } from './events.service';

/**
 * Разделы, по которым имеет смысл обновлять экраны, и что ещё меняется
 * вместе с ними. Например закрытие выезда начисляет смены, поэтому вместе
 * с «выездами» обновляем и «выплаты».
 */
const RELATED: Partial<Record<ChangedResource, ChangedResource[]>> = {
  orders: ['clients', 'shift-groups', 'reports', 'notifications'],
  'shift-groups': ['payroll', 'orders'],
  payroll: ['finance'],
  finance: ['reports'],
  clients: ['orders', 'notifications'],
  reports: ['finance'],
  tasks: ['notifications'],
  reminders: ['notifications'],
};

/**
 * Пути, которые меняют чужой раздел данных.
 *
 * Заявка с сайта приходит на /leads, а заводит клиента и заказ. Раздела
 * «leads» в списке нет, и объявления об изменении не было вовсе: новая
 * заявка появлялась в воронке и в колокольчике только со следующим опросом
 * по таймеру — до десяти секунд ожидания на ровном месте.
 */
const ALIAS: Record<string, ChangedResource> = {
  // заявка с сайта — это прежде всего НОВЫЙ ЗАКАЗ в воронке: доска слушает
  // именно «orders», а клиенты и уведомления подтянутся как связанные
  leads: 'orders',
};

/**
 * Первый значащий сегмент пути → раздел данных.
 *
 * У приложения глобальный префикс «api», и в пути он присутствует:
 * /api/clients. Его надо снять, иначе разделом всегда оказывается «api»
 * и о событии никто не узнаёт.
 */
function resourceOf(path: string): ChangedResource | null {
  const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts[0] === 'api') parts.shift();
  const seg = parts[0]?.split('?')[0];
  const known: ChangedResource[] = [
    'orders',
    'clients',
    'tasks',
    'shift-groups',
    'payroll',
    'finance',
    'reports',
    'proposals',
    'reminders',
    'checklists',
    'tariffs',
    'users',
    'cleaners',
    'brigades',
    'notifications',
    'trash',
  ];
  if (!seg) return null;
  if (known.includes(seg as ChangedResource)) return seg as ChangedResource;
  return ALIAS[seg] ?? null;
}

/**
 * Объявляет об изменении данных после каждого успешного запроса, который
 * что-то меняет.
 *
 * Сделано одним перехватчиком, а не вызовом из шестидесяти мест: любое
 * новое действие попадает в живой канал само, и о нём невозможно забыть.
 * Запросы на чтение пропускаем — они ничего не меняют.
 */
@Injectable()
export class ChangeBroadcastInterceptor implements NestInterceptor {
  constructor(private events: EventsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    if (req.method === 'GET' || req.method === 'OPTIONS') {
      return next.handle();
    }

    const resource = resourceOf(req.path ?? req.url ?? '');
    if (!resource) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const actorId = req.user?.id;
        this.events.publish(resource, actorId);
        for (const also of RELATED[resource] ?? []) {
          this.events.publish(also, actorId);
        }
      }),
    );
  }
}
