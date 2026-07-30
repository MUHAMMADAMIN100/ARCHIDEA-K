/**
 * Единый источник дат для всей CRM.
 *
 * Зачем: компания работает в Душанбе (UTC+5), а сервер на Railway — в UTC.
 * Пока каждый модуль считал границы дня сам через локальное время процесса,
 * «сегодня» на дашборде начиналось в 05:00 по Душанбе, а заказ, оплаченный
 * 1-го числа в 01:00, попадал в выручку предыдущего месяца.
 *
 * Все расчёты периодов (аналитика, выплаты, отчёты, смены) идут через этот модуль.
 */

export const TZ = 'Asia/Dushanbe';

/** Смещение Душанбе от UTC. Переходов на летнее время в Таджикистане нет. */
const OFFSET_MS = 5 * 60 * 60 * 1000;

/** Календарный день в Душанбе для момента времени: «2026-07-28» */
export function dayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Сегодняшняя дата по Душанбе в виде «ГГГГ-ММ-ДД» */
export function todayDushanbe(): string {
  return dayKey(new Date());
}

/**
 * «ГГГГ-ММ-ДД» → момент времени, которым этот день хранится в базе.
 * Даты-дни (смены, расписание) хранятся как полночь UTC — так принято в схеме.
 */
export function dayUTC(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Начало суток по Душанбе, выраженное в UTC */
export function startOfDay(d: Date = new Date()): Date {
  return new Date(dayUTC(dayKey(d)).getTime() - OFFSET_MS);
}

/** Начало периода в N дней, включая сегодняшний день */
function startOfLastDays(days: number, d: Date = new Date()): Date {
  const from = startOfDay(d);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return from;
}

/** Последние 7 дней, включая сегодня (как это понимает пользователь) */
export function startOfWeek(d: Date = new Date()): Date {
  return startOfLastDays(7, d);
}

/** Первое число текущего месяца по Душанбе */
export function startOfMonth(d: Date = new Date()): Date {
  const key = dayKey(d);
  return new Date(dayUTC(`${key.slice(0, 8)}01`).getTime() - OFFSET_MS);
}

/** Первое число текущего квартала по Душанбе */
export function startOfQuarter(d: Date = new Date()): Date {
  const key = dayKey(d);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7)); // 1..12
  const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const mm = String(firstMonth).padStart(2, '0');
  return new Date(dayUTC(`${year}-${mm}-01`).getTime() - OFFSET_MS);
}

/** Начало года по Душанбе */
export function startOfYear(d: Date = new Date()): Date {
  return new Date(dayUTC(`${dayKey(d).slice(0, 4)}-01-01`).getTime() - OFFSET_MS);
}

/**
 * Диапазон для фильтра по дню-снапшоту (смены, расписание — полночь UTC).
 * Обе границы включительно, любую можно опустить.
 */
export function rangeUTC(
  from?: string,
  to?: string,
): { gte?: Date; lte?: Date } {
  const r: { gte?: Date; lte?: Date } = {};
  if (from) r.gte = dayUTC(from);
  if (to) r.lte = dayUTC(to);
  return r;
}

/**
 * Диапазон для фильтра по точному времени события (createdAt, closedAt).
 * От начала дня `from` до конца дня `to` по Душанбе.
 */
export function momentRange(
  from?: string,
  to?: string,
): { gte?: Date; lte?: Date } {
  const r: { gte?: Date; lte?: Date } = {};
  if (from) r.gte = new Date(dayUTC(from).getTime() - OFFSET_MS);
  if (to) {
    const end = dayUTC(to);
    end.setUTCDate(end.getUTCDate() + 1);
    r.lte = new Date(end.getTime() - OFFSET_MS - 1);
  }
  return r;
}

/** Человекочитаемая дата по Душанбе: «28.07.2026» */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const key = dayKey(date);
  return `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}`;
}

/** Дата и время по Душанбе: «28.07.2026 14:30» */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const shifted = new Date(date.getTime() + OFFSET_MS).toISOString();
  return `${formatDate(date)} ${shifted.slice(11, 16)}`;
}

/**
 * Безопасный разбор даты из пользовательского ввода.
 * Возвращает null вместо Invalid Date — чтобы кривая строка из формы
 * не превращалась в исключение Prisma при записи.
 *
 * ВАЖНО про часовой пояс. Строка вида «2026-08-01T14:30» без указания зоны
 * трактуется движком как ЛОКАЛЬНОЕ время процесса. На машине разработчика это
 * Душанбе и всё сходится, а на Railway процесс работает в UTC — и «14:30»
 * сохранится как 14:30Z, то есть 19:30 по Душанбе. Поэтому дату-время без зоны
 * разбираем явно как местное время компании.
 */
export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string') return null;

  const local = parseDushanbeDateTime(value);
  if (local) return local;

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * «ГГГГ-ММ-ДДTЧЧ:ММ» (без зоны) → момент времени по часовому поясу Душанбе.
 * Возвращает null, если строка другого формата или указана зона — такую
 * строку разберёт обычный конструктор даты.
 */
export function parseDushanbeDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!m) return null;

  const [, y, mo, d, h, mi, sec] = m;
  const asUtc = new Date(
    `${y}-${mo}-${d}T${h}:${mi}:${sec ?? '00'}.000Z`,
  );
  if (Number.isNaN(asUtc.getTime())) return null;

  // введённое время — местное, значит фактический момент раньше на смещение
  return new Date(asUtc.getTime() - OFFSET_MS);
}

/** Обратное преобразование: момент времени → «ГГГГ-ММ-ДДTЧЧ:ММ» по Душанбе */
export function toDushanbeInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * «12.08.2026 14:30» по Душанбе — для текста уведомлений и сообщений.
 *
 * Сервер на Railway живёт в UTC, поэтому форматировать локальным временем
 * процесса нельзя: человек увидел бы время со сдвигом на пять часов.
 */
export function formatDushanbe(d: Date): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}
