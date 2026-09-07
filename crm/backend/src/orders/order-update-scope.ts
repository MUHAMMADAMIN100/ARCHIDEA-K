/**
 * Какие поля правки заказа затрагивают выезды в «Сменах».
 *
 * Выезд — это адрес, даты, состав (штатные, разовые, раскладка по дням) и
 * ответственный менеджер. Правка суммы, комментария или предпочтений на
 * выезды не влияет, и синхронизировать их незачем: это ещё с десяток
 * обращений к базе на каждое сохранение.
 */
export const VISIT_FIELDS = [
  'address',
  'scheduledDate',
  'scheduledEndDate',
  'preferredDate',
  'preferredTime',
  'managerId',
  'dayTeams',
  'guestCleaners',
  'cleanerIds',
] as const;

/** Трогает ли правка хоть одно поле, от которого зависят выезды */
export function touchesVisits(dto: Record<string, unknown>): boolean {
  return VISIT_FIELDS.some((key) => dto[key] !== undefined);
}
