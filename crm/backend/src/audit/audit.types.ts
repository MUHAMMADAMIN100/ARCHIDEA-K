/** Сущности, изменения которых попадают в журнал (ТЗ 2) */
export const AUDIT_ENTITIES = [
  'ORDER',
  'CLIENT',
  'USER',
  'SHIFT_GROUP',
  'SHIFT',
  'SERVICE',
  'TASK',
  'CLEANER',
  'REPORT',
  'FINANCE',
  'BONUS',
  'PROPOSAL',
  'CHECKLIST',
  'REMINDER',
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Одно изменённое поле: что было и что стало */
export interface AuditChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

/** Финансовые сущности скрыты от ops-менеджеров */
export const FINANCIAL_ENTITIES: AuditEntity[] = ['FINANCE', 'BONUS', 'REPORT'];

/**
 * Поля, значения которых нельзя писать в журнал ни при каких условиях.
 * Журнал доступен директору и живёт год — секретам там не место.
 */
export const MASKED_FIELDS = new Set([
  'passwordHash',
  'password',
  'sessionEpoch',
  'failedLogins',
  'lockedUntil',
  'telegramChatId',
]);

/** Человеческие названия полей — журнал читают люди, а не разработчики */
export const FIELD_LABELS: Record<string, string> = {
  fullName: 'ФИО',
  phone: 'Телефон',
  email: 'Почта',
  address: 'Адрес',
  login: 'Логин',
  role: 'Роль',
  position: 'Должность',
  duties: 'Обязанности',
  mainTask: 'Основная задача',
  isActive: 'Активен',
  acceptsLeads: 'Получает заявки',
  canManageOps: 'Расширенный доступ',
  canManageTasks: 'Полный доступ к задачам',
  stage: 'Этап воронки',
  source: 'Источник',
  cleaningType: 'Вид уборки',
  serviceKey: 'Услуга',
  dirtLevel: 'Загрязнение',
  area: 'Площадь',
  seats: 'Посадочных мест',
  estimatedPrice: 'Предварительная сумма',
  pricePerSqm: 'Цена за единицу',
  finalPrice: 'Итоговая сумма',
  isManualPrice: 'Сумма задана вручную',
  preferences: 'Предпочтения',
  comment: 'Комментарий',
  notes: 'Заметки',
  managerId: 'Ответственный менеджер',
  clientId: 'Клиент',
  scheduledDate: 'Дата уборки',
  inspectionDate: 'Дата осмотра',
  preferredDate: 'Желаемая дата',
  preferredTime: 'Желаемое время',
  rejectionReason: 'Причина отказа',
  isLarge: 'Крупный заказ',
  closedAt: 'Дата закрытия',
  tags: 'Теги',
  title: 'Название',
  description: 'Описание',
  priority: 'Приоритет',
  status: 'Статус',
  deadline: 'Срок',
  rate: 'Ставка',
  amount: 'Сумма',
  reason: 'Причина',
  category: 'Статья',
  kind: 'Тип',
  date: 'Дата',
  price: 'Цена',
  priceLight: 'Цена (лёгкое)',
  priceMedium: 'Цена (среднее)',
  priceHeavy: 'Цена (тяжёлое)',
  hasLevels: 'Цены по загрязнению',
  unit: 'Единица',
  isSystem: 'Базовая услуга',
  sortOrder: 'Порядок',
  brigadeId: 'Бригада',
  brigadierId: 'Бригадир',
  startTime: 'Время начала',
  endTime: 'Время окончания',
  note: 'Примечание',
  remindAt: 'Когда напомнить',
  assigneeId: 'Исполнитель',
  isRepeat: 'Повторный клиент',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
