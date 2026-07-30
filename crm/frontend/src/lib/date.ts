/**
 * Работа с датами в часовом поясе компании (Душанбе, UTC+5).
 *
 * Зачем отдельный модуль: браузер сотрудника может стоять в другом поясе, а
 * «сегодня» в CRM должно означать сегодняшний день в Душанбе — иначе смены и
 * выручка съезжают на сутки. Раньше такие функции были продублированы
 * в Shifts.tsx и Calendar.tsx.
 */

const OFFSET_MS = 5 * 60 * 60 * 1000;

/** Календарный день по Душанбе: «2026-07-29» */
export function toISODate(d: Date | string | number = new Date()): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Сегодняшняя дата по Душанбе */
export function todayISO(): string {
  return toISODate(new Date());
}

/** Сдвиг календарного дня на N дней (может быть отрицательным) */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Первый и последний день месяца, в котором лежит дата */
export function monthRange(iso: string = todayISO()): {
  from: string;
  to: string;
} {
  const from = `${iso.slice(0, 7)}-01`;
  const d = new Date(`${from}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}

/** Соседний месяц: «2026-07» → «2026-08» при step = 1 */
export function shiftMonth(iso: string, step: number): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + step);
  return d.toISOString().slice(0, 10);
}

export type PeriodPreset =
  | 'today'
  | 'week'
  | 'month'
  | 'prevMonth'
  | 'quarter'
  | 'year'
  | 'all';

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  today: 'Сегодня',
  week: 'Неделя',
  month: 'Месяц',
  prevMonth: 'Прошлый месяц',
  quarter: 'Квартал',
  year: 'Год',
  all: 'Всё время',
};

/**
 * Начало календарной недели (понедельник) для даты «ГГГГ-ММ-ДД».
 *
 * Раньше «Неделя» означала «последние 7 дней», и фильтр показывал 24–30 июля,
 * тогда как календарь показывал ту же неделю как 27.07–02.08. Две разные
 * недели в одной системе — источник постоянной путаницы в отчётах.
 */
export function startOfWeekISO(iso: string = todayISO()): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 — воскресенье
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

/** Диапазон дат для готового периода — полный календарный период */
export function rangeOf(preset: PeriodPreset): { from: string; to: string } {
  const today = todayISO();
  const year = today.slice(0, 4);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const from = startOfWeekISO(today);
      return { from, to: addDays(from, 6) };
    }
    case 'prevMonth': {
      const prev = shiftMonth(today, -1);
      return monthRange(prev);
    }
    case 'quarter': {
      const month = Number(today.slice(5, 7));
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      const last = first + 2;
      const from = `${year}-${String(first).padStart(2, '0')}-01`;
      // конец квартала — последний день третьего его месяца
      return { from, to: monthRange(`${year}-${String(last).padStart(2, '0')}-01`).to };
    }
    case 'year':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'all':
      return { from: '', to: '' };
    case 'month':
    default:
      return monthRange(today);
  }
}

/** «29.07.2026» по Душанбе */
export function formatDateTz(s?: string | null): string {
  if (!s) return '—';
  const iso = toISODate(s);
  if (!iso) return '—';
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** «29.07.2026 14:30» по Душанбе */
export function formatDateTimeTz(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  const shifted = new Date(d.getTime() + OFFSET_MS).toISOString();
  return `${formatDateTz(s)} ${shifted.slice(11, 16)}`;
}

/** Значение для <input type="datetime-local"> в местном времени компании */
export function toDateTimeInput(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * Сколько дней осталось до даты (отрицательное — просрочено).
 * Считаем по календарным дням Душанбе, а не по «ровно 24 часа».
 */
export function daysUntil(s?: string | null): number | null {
  if (!s) return null;
  const target = toISODate(s);
  if (!target) return null;
  const a = Date.parse(`${todayISO()}T00:00:00Z`);
  const b = Date.parse(`${target}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** «через 3 дня», «сегодня», «просрочено на 2 дня» */
export function humanDeadline(s?: string | null): string {
  const days = daysUntil(s);
  if (days === null) return '—';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === -1) return 'вчера';
  const n = Math.abs(days);
  const word = n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'дня' : 'дней';
  return days > 0 ? `через ${n} ${word}` : `просрочено на ${n} ${word}`;
}
