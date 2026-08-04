import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, seesAll } from '../common/decorators/current-user.decorator';
import { NOT_DELETED } from '../common/soft-delete';
import { dayKey } from '../common/time/dushanbe';

/** Одна часть объекта, попавшая в дневную выработку */
interface PlanPiece {
  title: string;
  area: number;
}

/** День плана производства работ */
export interface PlanDay {
  /** Номер дня по порядку, 1..N */
  day: number;
  /** Календарная дата, если у заказа назначен день уборки */
  date: string | null;
  area: number;
  pieces: PlanPiece[];
}

/**
 * План производства работ и срок по заказу (ТЗ: планирование).
 *
 * Считается, а не хранится. Причина простая: план целиком выводится из уже
 * известных вещей — объёма работ, выработки из справочника услуг и числа
 * людей в бригаде. Отдельная таблица немедленно начала бы расходиться с ними:
 * поменяли состав бригады — а в сохранённом плане прежние сроки.
 *
 * Считаем консервативно: неполный день — это день. Бригада не выезжает
 * «на полдня», а клиенту важно, когда работы закончатся, а не сколько
 * человеко-часов потрачено.
 */
@Injectable()
export class PlanService {
  constructor(private prisma: PrismaService) {}

  async forOrder(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...NOT_DELETED },
      select: {
        id: true,
        managerId: true,
        serviceKey: true,
        cleaningType: true,
        area: true,
        seats: true,
        scheduledDate: true,
        cleaners: { select: { id: true } },
        guestCleaners: true,
        segments: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            parentId: true,
            kind: true,
            title: true,
            area: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (!seesAll(user) && order.managerId !== user.id) {
      throw new NotFoundException('Заказ не найден');
    }

    const key = order.serviceKey ?? order.cleaningType;
    const tariff = key
      ? await this.prisma.tariff.findFirst({
          where: { key, ...NOT_DELETED },
          select: { title: true, unit: true, outputPerDay: true },
        })
      : null;

    const perPersonPerDay = tariff?.outputPerDay ?? 0;
    const perSeat = (tariff?.unit ?? 'м²') !== 'м²';
    const volume = perSeat ? (order.seats ?? 0) : (order.area ?? 0);

    // разовые сотрудники считаются наравне со штатными — работают-то они вместе
    const guests = Array.isArray(order.guestCleaners)
      ? (order.guestCleaners as unknown[]).length
      : 0;
    const people = Math.max(1, order.cleaners.length + guests);

    /*
     * Без выработки срок посчитать нечем: услуги, у которых её не задали,
     * честно возвращают «не рассчитывается», а не выдуманное число.
     */
    if (perPersonPerDay <= 0 || volume <= 0) {
      return {
        canPlan: false,
        reason:
          perPersonPerDay <= 0
            ? 'У услуги не задана выработка — укажите её в разделе «Услуги и цены»'
            : 'У заказа не задан объём работ',
        unit: tariff?.unit ?? 'м²',
        perPersonPerDay,
        people,
        volume,
        days: [] as PlanDay[],
        totalDays: 0,
      };
    }

    const perDay = perPersonPerDay * people;
    const totalDays = Math.max(1, Math.ceil(volume / perDay));

    // помещения из разбивки объекта — план по ним нагляднее, чем по метрам
    const rooms = order.segments
      .filter((s) => s.kind === 'ROOM' && (s.area ?? 0) > 0)
      .map((s) => ({ title: s.title, area: s.area as number }));

    const days: PlanDay[] = [];
    const start = order.scheduledDate ? new Date(order.scheduledDate) : null;
    const dateOf = (index: number): string | null => {
      if (!start) return null;
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + index);
      return dayKey(d);
    };

    if (rooms.length) {
      /*
       * Раскладываем помещения по дням: помещение целиком уходит в один день,
       * пока дневная норма не выбрана. Делить комнату между днями бессмысленно
       * — бригада не уходит из середины кабинета.
       */
      let current: PlanPiece[] = [];
      let currentArea = 0;
      for (const room of rooms) {
        if (currentArea > 0 && currentArea + room.area > perDay) {
          days.push({
            day: days.length + 1,
            date: dateOf(days.length),
            area: currentArea,
            pieces: current,
          });
          current = [];
          currentArea = 0;
        }
        current.push(room);
        currentArea += room.area;
      }
      if (current.length) {
        days.push({
          day: days.length + 1,
          date: dateOf(days.length),
          area: currentArea,
          pieces: current,
        });
      }
    } else {
      // разбивки нет — план по объёму: столько-то единиц в день
      let left = volume;
      while (left > 0 && days.length < 400) {
        const chunk = Math.min(perDay, left);
        days.push({
          day: days.length + 1,
          date: dateOf(days.length),
          area: chunk,
          pieces: [],
        });
        left -= chunk;
      }
    }

    return {
      canPlan: true,
      reason: null,
      serviceTitle: tariff?.title ?? null,
      unit: tariff?.unit ?? 'м²',
      perPersonPerDay,
      people,
      volume,
      perDay,
      totalDays: days.length || totalDays,
      days,
    };
  }
}
