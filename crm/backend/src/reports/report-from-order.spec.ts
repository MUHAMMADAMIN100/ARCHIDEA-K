import { CleaningType } from '@prisma/client';
import {
  planWorkerSync,
  reportDataFromOrder,
  shiftsOfOrder,
  workersFromOrder,
} from './report-from-order';

/**
 * Смены в ведомости — по длительности заказа.
 *
 * Уборка на два дня оплачивается людям как две смены. Пока здесь стояла
 * единица, ведомость расходилась с деньгами, которые владелец отдаёт на
 * руки: заказ на 11–12 августа с пятью клинерами по 230 давал 1 150
 * вместо 2 300.
 */
describe('Смены по длительности заказа', () => {
  const д = (iso: string) => new Date(iso);

  it('11–12 августа — две смены', () => {
    expect(
      shiftsOfOrder({
        scheduledDate: д('2026-08-11T03:00:00.000Z'),
        scheduledEndDate: д('2026-08-12T00:00:00.000Z'),
      }),
    ).toBe(2);
  });

  it('без последнего дня — одна смена', () => {
    expect(
      shiftsOfOrder({
        scheduledDate: д('2026-08-11T03:00:00.000Z'),
        scheduledEndDate: null,
      }),
    ).toBe(1);
  });

  it('последний день равен первому — одна смена, а не ноль', () => {
    expect(
      shiftsOfOrder({
        scheduledDate: д('2026-08-11T03:00:00.000Z'),
        scheduledEndDate: д('2026-08-11T03:00:00.000Z'),
      }),
    ).toBe(1);
  });

  it('перепутанные местами даты не дают отрицательных смен', () => {
    expect(
      shiftsOfOrder({
        scheduledDate: д('2026-08-12T03:00:00.000Z'),
        scheduledEndDate: д('2026-08-11T03:00:00.000Z'),
      }),
    ).toBe(1);
  });

  it('опечатка в годе не начисляет сотни смен', () => {
    expect(
      shiftsOfOrder({
        scheduledDate: д('2026-08-11T03:00:00.000Z'),
        scheduledEndDate: д('2027-08-11T03:00:00.000Z'),
      }),
    ).toBe(31);
  });

  it('неделя — семь смен', () => {
    expect(
      shiftsOfOrder({
        scheduledDate: д('2026-08-11T03:00:00.000Z'),
        scheduledEndDate: д('2026-08-17T03:00:00.000Z'),
      }),
    ).toBe(7);
  });

  /*
   * Разница считается по календарным дням Душанбе. Ранняя уборка стартует
   * в 05:00 по Душанбе — это 00:00 UTC того же дня; вычитание «в лоб» дало
   * бы дробное число часов, а не дни.
   */
  it('ранний старт не сбивает счёт', () => {
    expect(
      shiftsOfOrder({
        scheduledDate: д('2026-08-11T00:00:00.000Z'),
        scheduledEndDate: д('2026-08-12T14:00:00.000Z'),
      }),
    ).toBe(2);
  });
});

describe('Строки работников ведомости', () => {
  const заказ = {
    id: 'o1',
    address: 'ул. Рудаки',
    area: 100,
    seats: null,
    cleaningType: CleaningType.GENERAL,
    pricePerSqm: 34,
    finalPrice: 8000,
    estimatedPrice: 8000,
    scheduledDate: new Date('2026-08-11T03:00:00.000Z'),
    scheduledEndDate: new Date('2026-08-12T00:00:00.000Z'),
    closedAt: null,
    createdAt: new Date('2026-08-11T03:00:00.000Z'),
    managerId: 'm1',
    client: { fullName: 'Али', phone: '900000000' },
    manager: { id: 'm1', fullName: 'Аниса' },
    discount: 0,
    cleaners: [
      { id: 'c1', fullName: 'Курбонгул', rate: 230 },
      { id: 'c2', fullName: 'Муслима', rate: 230 },
      { id: 'c3', fullName: 'Нигора', rate: 230 },
      { id: 'c4', fullName: 'Рафоат', rate: 230 },
      { id: 'c5', fullName: 'Робия', rate: 230 },
    ],
    guestCleaners: [
      { fullName: 'Мичгона', rate: 460 },
      { fullName: 'Рухшона', rate: 180 },
      { fullName: 'Бонусы сотрудникам', rate: 500 },
    ],
  };

  it('заказ «Али»: штат по две смены, итог 3 440', () => {
    const rows = workersFromOrder(заказ);
    const штат = rows.filter((r) => r.cleanerId);
    const разовые = rows.filter((r) => !r.cleanerId);

    expect(штат).toHaveLength(5);
    expect(штат.every((r) => r.days === 2)).toBe(true);
    // разовому вписывают сумму на руки целиком — её на дни не умножают
    expect(разовые.every((r) => r.days === 1)).toBe(true);

    const итог = rows.reduce((s, r) => s + r.days * r.rate, 0);
    expect(итог).toBe(3440);
  });

  it('тот же заказ на один день — 2 290', () => {
    const rows = workersFromOrder({ ...заказ, scheduledEndDate: null });
    expect(rows.reduce((s, r) => s + r.days * r.rate, 0)).toBe(2290);
  });

  it('шапка ведомости несёт оба дня уборки', () => {
    const данные = reportDataFromOrder(заказ, 'm1');
    const день = (v: unknown) => (v as Date).toISOString().slice(0, 10);
    expect(день(данные.workDate)).toBe('2026-08-11');
    expect(день(данные.workEndDate)).toBe('2026-08-12');
  });

  it('однодневный заказ не выдумывает дату завершения', () => {
    const данные = reportDataFromOrder({ ...заказ, scheduledEndDate: null }, 'm1');
    expect(данные.workEndDate).toBeNull();
  });

  it('без штатных остаются одни разовые', () => {
    const rows = workersFromOrder({ ...заказ, cleaners: [] });
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, r) => s + r.days * r.rate, 0)).toBe(1140);
  });
});

describe('planWorkerSync — ведомость следует за карточкой заказа', () => {
  const staff = (id: string, fullName: string, rate = 230, leader = false) => ({
    id, fullName, rate, leaderOf: leader ? { id: 'b' } : null,
  });
  const row = (id: string, cleanerId: string | null, fullName: string, rate: number, days = 1, role = 'Клинер') => ({
    id, cleanerId, fullName, rate, role, days,
  });
  const orderOf = (cleaners: ReturnType<typeof staff>[], guests: { fullName: string; rate: number }[] = [], end: Date | null = null) =>
    ({
      id: 'o', address: null, area: 100, seats: null, cleaningType: CleaningType.GENERAL,
      pricePerSqm: 27, finalPrice: 2700, estimatedPrice: 2700,
      scheduledDate: new Date('2026-09-07T03:00:00Z'), scheduledEndDate: end,
      closedAt: null, createdAt: new Date('2026-09-03T00:00:00Z'), managerId: null,
      client: null, manager: null, discount: 0, cleaners, guestCleaners: guests,
    }) as unknown as import('./report-from-order').OrderForReport;

  it('случай «Фархунда»: принятая ведомость с пятью, в карточке шестая — добавить одну строку', () => {
    const existing = [
      row('r1', 'k', 'Кибриё', 330, 1, 'Бригадир'), row('r2', 'z', 'Замира', 230), row('r3', 'm', 'Мафтуна', 230),
      row('r4', 'r', 'Рафоат', 230), row('r5', 't', 'Тамано', 230),
    ];
    const wanted = workersFromOrder(orderOf([
      staff('k', 'Кибриё', 330, true), staff('z', 'Замира'), staff('m', 'Мафтуна'), staff('r', 'Рафоат'), staff('t', 'Тамано'), staff('g', 'Гулнамо'),
    ]));
    const plan = planWorkerSync(existing, wanted);
    expect(plan.toAdd.map((w) => [w.fullName, w.rate, w.days])).toEqual([['Гулнамо', 230, 1]]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it('человека убрали из карточки — его строка уходит; ставка оставшихся не трогается', () => {
    const existing = [row('r1', 'a', 'А', 230), row('r2', 'b', 'Б', 230)];
    // в справочнике ставку А подняли до 250 — в ведомости остаётся снапшот 230
    const plan = planWorkerSync(existing, workersFromOrder(orderOf([staff('a', 'А', 250)])));
    expect(plan.toRemove.map((w) => w.fullName)).toEqual(['Б']);
    expect(plan.updates).toEqual([]);
  });

  it('уборка стала двухдневной — у штатных дни 1 → 2, у разового остаётся 1', () => {
    const existing = [row('r1', 'a', 'А', 230, 1), row('g1', null, 'Курбон', 200, 1, 'Разовый')];
    const plan = planWorkerSync(
      existing,
      workersFromOrder(orderOf([staff('a', 'А')], [{ fullName: 'Курбон', rate: 200 }], new Date('2026-09-08T03:00:00Z'))),
    );
    expect(plan.updates.map((u) => u.note)).toEqual(['А дней 1 → 2']);
    expect(plan.toAdd).toEqual([]);
  });

  it('разовому поменяли сумму в карточке — ведомость повторяет, строка не дублируется', () => {
    const existing = [row('g1', null, 'Курбон', 250, 1, 'Разовый')];
    const plan = planWorkerSync(existing, workersFromOrder(orderOf([], [{ fullName: 'курбон', rate: 230 }])));
    expect(plan.toAdd).toEqual([]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.updates.map((u) => u.note)).toEqual(['Курбон 250 → 230']);
  });

  it('всё совпадает — план пустой', () => {
    const existing = [row('r1', 'a', 'А', 230)];
    const plan = planWorkerSync(existing, workersFromOrder(orderOf([staff('a', 'А')])));
    expect([plan.toAdd.length, plan.toRemove.length, plan.updates.length]).toEqual([0, 0, 0]);
  });
});
