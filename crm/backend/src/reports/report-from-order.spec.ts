import { CleaningType } from '@prisma/client';
import { shiftsOfOrder, workersFromOrder } from './report-from-order';

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

  it('без штатных остаются одни разовые', () => {
    const rows = workersFromOrder({ ...заказ, cleaners: [] });
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, r) => s + r.days * r.rate, 0)).toBe(1140);
  });
});
