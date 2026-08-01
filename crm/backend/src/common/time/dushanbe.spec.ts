import {
  dayKey,
  dayUTC,
  formatDate,
  formatDateTime,
  momentRange,
  parseDate,
  parseDushanbeDateTime,
  rangeUTC,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  toDushanbeInput,
} from './dushanbe';

/**
 * Компания работает в Душанбе (UTC+5), сервер на Railway — в UTC.
 * Пока каждый модуль считал сутки сам, «сегодня» начиналось в 05:00 по
 * местному времени, а заказ, оплаченный 1-го числа в час ночи, попадал
 * в выручку предыдущего месяца. Здесь это зафиксировано числами.
 */

const iso = (d: Date) => d.toISOString();

describe('Календарный день по Душанбе', () => {
  it('полночь UTC — это уже 05:00 в Душанбе, день тот же', () => {
    expect(dayKey(new Date('2026-08-01T00:00:00Z'))).toBe('2026-08-01');
  });

  it('19:00 UTC — это полночь следующего дня в Душанбе', () => {
    expect(dayKey(new Date('2026-07-31T19:00:00Z'))).toBe('2026-08-01');
  });

  it('за минуту до этого день ещё вчерашний', () => {
    expect(dayKey(new Date('2026-07-31T18:59:59Z'))).toBe('2026-07-31');
  });
});

describe('Границы периодов', () => {
  const moment = new Date('2026-08-01T10:00:00Z'); // суббота, 15:00 в Душанбе

  it('начало суток — 19:00 UTC предыдущего дня', () => {
    expect(iso(startOfDay(moment))).toBe('2026-07-31T19:00:00.000Z');
  });

  it('начало недели — понедельник, а не «сегодня минус семь дней»', () => {
    // 01.08.2026 — суббота, значит понедельник этой недели 27.07.2026
    expect(iso(startOfWeek(moment))).toBe('2026-07-26T19:00:00.000Z');
  });

  it('начало месяца — первое число по местному времени', () => {
    expect(iso(startOfMonth(new Date('2026-08-15T10:00:00Z')))).toBe(
      '2026-07-31T19:00:00.000Z',
    );
  });

  it('начало квартала — первое число июля для августа', () => {
    expect(iso(startOfQuarter(moment))).toBe('2026-06-30T19:00:00.000Z');
  });

  it('начало года — первое января по местному времени', () => {
    expect(iso(startOfYear(moment))).toBe('2025-12-31T19:00:00.000Z');
  });
});

describe('Два разных диапазона нельзя путать', () => {
  it('rangeUTC — для дней-снапшотов (смены, выезды): ровно полночь UTC', () => {
    const r = rangeUTC('2026-08-01', '2026-08-05');
    expect(iso(r.gte!)).toBe('2026-08-01T00:00:00.000Z');
    expect(iso(r.lte!)).toBe('2026-08-05T00:00:00.000Z');
  });

  it('momentRange — для событий (createdAt, closedAt): сутки по Душанбе', () => {
    const r = momentRange('2026-08-01', '2026-08-01');
    expect(iso(r.gte!)).toBe('2026-07-31T19:00:00.000Z');
    expect(iso(r.lte!)).toBe('2026-08-01T18:59:59.999Z');
  });

  it('границы можно опускать по одной', () => {
    expect(momentRange('2026-08-01', undefined).lte).toBeUndefined();
    expect(momentRange(undefined, '2026-08-01').gte).toBeUndefined();
    expect(momentRange()).toEqual({});
  });
});

describe('Заказ, оплаченный ночью, не уезжает в чужой месяц', () => {
  // 01.08.2026, 01:00 по Душанбе = 31.07.2026, 20:00 UTC
  const paidAt = new Date('2026-07-31T20:00:00Z');

  it('день считается августовским', () => {
    expect(dayKey(paidAt)).toBe('2026-08-01');
  });

  it('и попадает в диапазон августа, а не июля', () => {
    const august = startOfMonth(new Date('2026-08-10T00:00:00Z'));
    expect(paidAt.getTime()).toBeGreaterThanOrEqual(august.getTime());
  });

  it('и попадает в выборку за 1 августа', () => {
    const day = momentRange('2026-08-01', '2026-08-01');
    expect(paidAt.getTime()).toBeGreaterThanOrEqual(day.gte!.getTime());
    expect(paidAt.getTime()).toBeLessThanOrEqual(day.lte!.getTime());
  });
});

describe('Разбор пользовательского ввода', () => {
  it('время без зоны считается МЕСТНЫМ, а не UTC сервера', () => {
    // 14:30 в Душанбе — это 09:30 UTC
    expect(iso(parseDushanbeDateTime('2026-08-01T14:30')!)).toBe(
      '2026-08-01T09:30:00.000Z',
    );
  });

  it('пробел вместо T и секунды тоже понимаются', () => {
    expect(iso(parseDushanbeDateTime('2026-08-01 14:30:15')!)).toBe(
      '2026-08-01T09:30:15.000Z',
    );
  });

  it('строка с явной зоной разбирается обычным путём', () => {
    expect(parseDushanbeDateTime('2026-08-01T14:30:00Z')).toBeNull();
    expect(iso(parseDate('2026-08-01T14:30:00Z')!)).toBe(
      '2026-08-01T14:30:00.000Z',
    );
  });

  it('кривая дата даёт null, а не падение записи в базу', () => {
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('какой-то мусор')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate({})).toBeNull();
  });

  it('готовая дата и число проходят как есть', () => {
    const d = new Date('2026-08-01T00:00:00Z');
    expect(parseDate(d)).toBe(d);
    expect(iso(parseDate(d.getTime())!)).toBe('2026-08-01T00:00:00.000Z');
    expect(parseDate(new Date('нечто'))).toBeNull();
  });
});

describe('Показ дат человеку', () => {
  const moment = new Date('2026-08-01T09:30:00Z'); // 14:30 в Душанбе

  it('дата в привычном виде', () => {
    expect(formatDate(moment)).toBe('01.08.2026');
  });

  it('время показывается местное, а не серверное', () => {
    expect(formatDateTime(moment)).toBe('01.08.2026 14:30');
  });

  it('пустое значение не превращается в «Invalid Date»', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDateTime(null)).toBe('');
    expect(formatDate('мусор')).toBe('');
  });

  it('поле формы и обратный разбор дают тот же момент', () => {
    const input = toDushanbeInput(moment);
    expect(input).toBe('2026-08-01T14:30');
    expect(iso(parseDushanbeDateTime(input)!)).toBe(iso(moment));
  });
});

describe('Хранение дня-снапшота', () => {
  it('день превращается в полночь UTC', () => {
    expect(iso(dayUTC('2026-08-01'))).toBe('2026-08-01T00:00:00.000Z');
  });
});
