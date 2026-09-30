import { dayKey } from '../common/time/dushanbe';

/**
 * Порядок ведомостей в списке — по дням работ (просьба владельца).
 *
 * Раньше список шёл по моменту, когда ведомость составили, а в строке
 * первой стоит дата работ: 28.09, 29.09, 27.09, … 19.09, 22.09 — на глаз
 * это выглядело беспорядком. Теперь порядок совпадает с тем, что видно в
 * строке.
 */
export interface SortableReport {
  /** дата работ (полночь UTC календарного дня) */
  workDate: Date | null;
  /** когда ведомость составили */
  createdAt: Date;
  order?: { createdAt: Date } | null;
}

/**
 * День, который строка списка показывает первым: дата работ, а без неё —
 * день, когда ведомость составили (по Душанбе, как видит пользователь).
 */
export function reportDay(r: SortableReport): string {
  return dayKey(r.workDate ?? r.createdAt);
}

/**
 * Новые дни сверху. При одинаковом дне выше ведомость с более новым
 * заказом (у ведомости без заказа вместо него — момент её составления),
 * дальше — составленная позже. Статус на порядок не влияет: ждущие приёма
 * отбираются фильтром «Состояние» (решение владельца).
 */
export function byWorkDayDesc(a: SortableReport, b: SortableReport): number {
  const da = reportDay(a);
  const db = reportDay(b);
  if (da !== db) return da < db ? 1 : -1;
  const oa = (a.order?.createdAt ?? a.createdAt).getTime();
  const ob = (b.order?.createdAt ?? b.createdAt).getTime();
  if (oa !== ob) return ob - oa;
  return b.createdAt.getTime() - a.createdAt.getTime();
}
