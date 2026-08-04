import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, seesAll } from '../common/decorators/current-user.decorator';
import { NOT_DELETED } from '../common/soft-delete';
import { dayKey } from '../common/time/dushanbe';
import { billableUnits } from './order-pricing';

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
 * Сколько дней помещается в печатный график.
 *
 * Ограничение чисто про удобочитаемость: простыню на пять тысяч строк никто
 * не читает. Срок работ при этом считается полностью и не обрезается.
 */
const MAX_PLAN_DAYS = 400;

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
    /*
     * Объём берём той же функцией, что и расчёт цены. Повтори мы её логику
     * здесь своими словами — срок и сумма однажды разошлись бы: у одной
     * услуги объём считается площадью, у другой посадочными местами.
     */
    const volume = billableUnits(
      { serviceKey: key, area: order.area, seats: order.seats },
      tariff
        ? {
            key,
            unit: tariff.unit,
            hasLevels: false,
            priceLight: 0,
            priceMedium: 0,
            priceHeavy: 0,
            pricePerSqm: 0,
          }
        : null,
    );

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

    /*
     * Помещения из разбивки объекта — план по ним нагляднее, чем по метрам.
     *
     * Помещения без указанной площади в план тоже входят: раньше они молча
     * выпадали, и бригада просто не знала, что туда надо зайти. Дневную норму
     * они не расходуют (метража нет), но в списке дня стоят.
     */
    const rooms = order.segments
      .filter((s) => s.kind === 'ROOM')
      .map((s) => ({ title: s.title, area: Math.max(0, s.area ?? 0) }));
    const roomsWithoutArea = rooms.filter((r) => r.area === 0).length;

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
       *
       * Исключение — помещение больше дневной нормы: зал на 500 м² при норме
       * 100 нельзя показывать как один день. Такое помещение раскладывается на
       * столько дней, сколько реально нужно, и в каждом дне подписано частью.
       * Иначе план выдавал бы правдоподобный, но заниженный срок — это хуже,
       * чем не показать ничего.
       */
      let current: PlanPiece[] = [];
      let currentArea = 0;
      const closeDay = () => {
        if (!current.length) return;
        days.push({
          day: days.length + 1,
          date: dateOf(days.length),
          area: currentArea,
          pieces: current,
        });
        current = [];
        currentArea = 0;
      };

      for (const room of rooms) {
        if (room.area > perDay) {
          closeDay();
          const parts = Math.ceil(room.area / perDay);
          let left = room.area;
          for (let i = 1; i <= parts && days.length < MAX_PLAN_DAYS; i += 1) {
            const chunk = Math.min(perDay, left);
            days.push({
              day: days.length + 1,
              date: dateOf(days.length),
              area: chunk,
              pieces: [{ title: `${room.title} (часть ${i} из ${parts})`, area: chunk }],
            });
            left -= chunk;
          }
          continue;
        }
        if (currentArea > 0 && currentArea + room.area > perDay) closeDay();
        current.push(room);
        currentArea += room.area;
        if (days.length >= MAX_PLAN_DAYS) break;
      }
      closeDay();
    } else {
      // разбивки нет — план по объёму: столько-то единиц в день
      let left = volume;
      while (left > 0 && days.length < MAX_PLAN_DAYS) {
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

    /*
     * График обрезан, если упёрся в предел строк: тогда дней работ больше,
     * чем мы показали, и об этом надо сказать прямо.
     */
    const truncated = days.length >= MAX_PLAN_DAYS && days.length < totalDays;

    return {
      canPlan: true,
      reason: null,
      serviceTitle: tariff?.title ?? null,
      unit: tariff?.unit ?? 'м²',
      perPersonPerDay,
      people,
      volume,
      perDay,
      /*
       * Срок — это расчёт, а не длина показанного списка.
       *
       * График обрезается на 400 днях: печатать простыню на пять тысяч строк
       * бессмысленно. Но раньше обрезанная длина и подставлялась как срок —
       * заказ на 2000 дней показывал «400 дней». Цифра выглядела достоверной
       * и была враньём, а срок клиенту называют именно по ней.
       *
       * Когда график НЕ обрезан, честнее взять его длину: помещения
       * укладываются по дням не идеально, и дней может выйти больше, чем даёт
       * деление объёма на норму.
       */
      totalDays: truncated ? totalDays : days.length || totalDays,
      /** Сколько дней уместилось в показанный график */
      daysShown: days.length,
      /** График показан не целиком — работ больше, чем строк в таблице */
      truncated,
      /*
       * Помещения без метража попадают в график, но норму не расходуют.
       * Говорим об этом прямо: иначе срок выглядит точным, хотя часть объёма
       * в нём просто не учтена.
       */
      roomsWithoutArea,
      days,
    };
  }
}
