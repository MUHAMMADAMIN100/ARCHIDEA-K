import type {
  AuditAction,
  CallType,
  CleaningType,
  ClientTag,
  DirtLevel,
  FunnelStage,
  LeadSource,
  FinanceCategory,
  FinanceKind,
  NotificationKind,
  Order,
  ProposalStatus,
  ReminderStatus,
  ReportStatus,
  ShiftGroupStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
  TrashType,
} from '../types';

export const STAGE_LABEL: Record<FunnelStage, string> = {
  NEW: 'Новая заявка',
  PROCESSING: 'Обработка',
  INSPECTION: 'Осмотр объекта',
  OFFER: 'Коммерческое предложение',
  CONFIRMED: 'Подтверждён',
  IN_PROGRESS: 'В работе',
  DONE: 'К оплате',
  PAID: 'Оплачено / Закрыто',
  REJECTED: 'Отказ',
};

/*
 * «Обработка» и «КП» исключены из процесса (ТЗ 3): в воронке их нет.
 * Сами значения остаются в типе ради старых записей истории.
 */
export const STAGE_ORDER: FunnelStage[] = [
  'NEW',
  'INSPECTION',
  'CONFIRMED',
  'IN_PROGRESS',
  'DONE',
  'PAID',
  'REJECTED',
];

/** Цвет «таблетки» этапа */
export const STAGE_COLOR: Record<FunnelStage, string> = {
  NEW: 'bg-navy-100 text-navy-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  INSPECTION: 'bg-amber-100 text-amber-700',
  OFFER: 'bg-purple-100 text-purple-700',
  CONFIRMED: 'bg-cyan-100 text-cyan-700',
  IN_PROGRESS: 'bg-indigo-100 text-indigo-700',
  DONE: 'bg-teal-100 text-teal-700',
  PAID: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export const TYPE_LABEL: Record<CleaningType, string> = {
  MAINTENANCE: 'Поддерживающая (архив)',
  GENERAL: 'Генеральная',
  POST_RENOVATION: 'После ремонта',
  FURNITURE: 'Мягкая мебель',
};

/** Типы, доступные для выбора в новых заказах (MAINTENANCE закрыта) */
export const ACTIVE_TYPES: CleaningType[] = [
  'GENERAL',
  'POST_RENOVATION',
  'FURNITURE',
];

export const DIRT_LABEL: Record<DirtLevel, string> = {
  LIGHT: 'Лёгкая',
  MEDIUM: 'Средняя',
  HEAVY: 'Тяжёлая',
};

export const DIRT_ORDER: DirtLevel[] = ['LIGHT', 'MEDIUM', 'HEAVY'];

/**
 * Ключ услуги → базовый вид уборки для бэкенда.
 * Своя услуга директора получает GENERAL: реальную услугу определяет
 * serviceKey, он приоритетнее (см. orders.service.ts).
 */
export function cleaningTypeForKey(key: string): CleaningType {
  const base: CleaningType[] = [
    'MAINTENANCE',
    'GENERAL',
    'POST_RENOVATION',
    'FURNITURE',
  ];
  return (base as string[]).includes(key) ? (key as CleaningType) : 'GENERAL';
}

/** «60 м²» / «3 места» — объём работ по типу услуги */
export function formatVolume(
  o: Pick<Order, 'cleaningType' | 'area' | 'seats'>,
): string {
  if (o.cleaningType === 'FURNITURE') return `${o.seats ?? 0} мест`;
  return `${o.area} м²`;
}

export const SOURCE_LABEL: Record<LeadSource, string> = {
  SITE: 'Сайт',
  INSTAGRAM: 'Instagram',
  CALL: 'Звонок',
  COLD_CALL: 'Холодный обзвон',
  RECOMMENDATION: 'Рекомендация',
  ANISA: 'От Анисы',
};

/** Порядок источников в выпадающих списках */
export const SOURCE_ORDER: LeadSource[] = [
  'SITE',
  'INSTAGRAM',
  'CALL',
  'COLD_CALL',
  'RECOMMENDATION',
  'ANISA',
];

/** Каким вышел разговор с клиентом */
export const CALL_TYPE_LABEL: Record<CallType, string> = {
  COLD: 'Холодный',
  NEUTRAL: 'Нейтральный',
  HOT: 'Горячий',
};

export const CALL_TYPE_ORDER: CallType[] = ['COLD', 'NEUTRAL', 'HOT'];

/**
 * Цвет типа звонка — привычная шкала «холодно/тепло/горячо»: синий, янтарный,
 * красный. По ней тип читается, даже когда подпись не помещается.
 */
export const CALL_TYPE_COLOR: Record<CallType, string> = {
  COLD: 'bg-sky-100 text-sky-800 border-sky-300',
  NEUTRAL: 'bg-amber-100 text-amber-800 border-amber-300',
  HOT: 'bg-red-100 text-red-800 border-red-300',
};

export const TAG_LABEL: Record<ClientTag, string> = {
  VIP: 'VIP',
  REGULAR: 'Постоянный',
  REFUSED: 'Отказник',
  POTENTIAL: 'Потенциальный',
};

export const TAG_COLOR: Record<ClientTag, string> = {
  VIP: 'bg-amber-100 text-amber-700',
  REGULAR: 'bg-green-100 text-green-700',
  REFUSED: 'bg-red-100 text-red-700',
  POTENTIAL: 'bg-blue-100 text-blue-700',
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочно',
};

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  LOW: 'bg-navy-100 text-navy-600',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-orange-100 text-orange-700',
  // срочное должно выделяться сильнее «высокого», иначе разница незаметна
  URGENT: 'bg-red-600 text-white',
};

/** Порядок в выпадающем списке и вес при сортировке: срочное — первым */
export const PRIORITY_ORDER: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export function priorityWeight(p: TaskPriority): number {
  const i = PRIORITY_ORDER.indexOf(p);
  return i === -1 ? PRIORITY_ORDER.length : i;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: 'Открыта',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнена',
};

export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  OPEN: 'bg-navy-100 text-navy-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  DONE: 'bg-green-100 text-green-700',
};

/**
 * Типы задач календаря (порядок = порядок кнопок фильтра и легенды).
 *
 * «Личное» из списка убрано: задачи в CRM ставят друг другу по работе, а
 * личные дела вели в другом месте. Старые задачи этого типа переведены во
 * «Встречу» миграцией, поэтому в системе его больше нет.
 */
export const TASK_TYPE_ORDER: TaskType[] = [
  'CALL',
  'INSPECTION',
  'VISIT',
  'MEETING',
];

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  CALL: 'Звонок',
  INSPECTION: 'Осмотр объекта',
  VISIT: 'Выезд',
  MEETING: 'Встреча',
  PERSONAL: 'Личное',
};

/** Цвет карточки задачи в календаре (фон / текст / рамка) */
export const TASK_TYPE_COLOR: Record<TaskType, string> = {
  CALL: 'bg-sky-50 text-sky-800 border-sky-200',
  INSPECTION: 'bg-violet-50 text-violet-800 border-violet-200',
  VISIT: 'bg-amber-50 text-amber-800 border-amber-200',
  MEETING: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  PERSONAL: 'bg-navy-50 text-navy-700 border-navy-200',
};

/** Цвет точки-маркера типа (легенда, компактные списки) */
export const TASK_TYPE_DOT: Record<TaskType, string> = {
  CALL: 'bg-sky-500',
  INSPECTION: 'bg-violet-500',
  VISIT: 'bg-amber-500',
  MEETING: 'bg-emerald-500',
  PERSONAL: 'bg-navy-400',
};

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  DRAFT: 'Черновик',
  SENT: 'Отправлен',
  ACCEPTED: 'Принят',
};

/** Порядок состояний для отбора: как ведомость движется по жизни */
export const REPORT_STATUS_ORDER: ReportStatus[] = ['DRAFT', 'SENT', 'ACCEPTED'];

export const REPORT_STATUS_COLOR: Record<ReportStatus, string> = {
  DRAFT: 'bg-navy-100 text-navy-600',
  SENT: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-green-100 text-green-700',
};

/**
 * Полная стоимость заказа: итог после осмотра, а пока его нет — расчётная.
 */
export function orderTotal(
  o: Pick<Order, 'finalPrice' | 'estimatedPrice'>,
): number {
  return o.finalPrice ?? o.estimatedPrice ?? 0;
}

/**
 * Сколько по заказу ещё предстоит получить: полная стоимость минус то,
 * что клиент уже заплатил.
 *
 * Это ДОПОЛНЕНИЕ к сумме заказа, а не замена ей. В воронке, календаре и
 * списке заказов клиента главным числом идёт `orderTotal` — заработанные
 * деньги, — а долг показывается припиской и только когда он есть. Раньше
 * везде показывался остаток, и полностью оплаченный заказ выглядел как
 * «0 сомони», а этап «Оплачено» — как пустой по деньгам.
 */
export function orderDue(
  o: Pick<Order, 'finalPrice' | 'estimatedPrice' | 'paidAmount'>,
): number {
  return Math.max(0, orderTotal(o) - (o.paidAmount ?? 0));
}

export function formatPrice(v?: number | null): string {
  if (v == null) return '—';
  return `${v.toLocaleString('ru-RU')} сомони`;
}

export function formatDate(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ═══════════════════════════════════════════════════════════
//  Словари разделов, добавленных по ТЗ
// ═══════════════════════════════════════════════════════════


// ── Финансы (ТЗ 7) ──

export const FINANCE_KIND_LABEL: Record<FinanceKind, string> = {
  INCOME: 'Доход',
  EXPENSE: 'Расход',
};

export const FINANCE_KIND_COLOR: Record<FinanceKind, string> = {
  INCOME: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPENSE: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const FINANCE_CATEGORY_LABEL: Record<FinanceCategory, string> = {
  ORDER_PAYMENT: 'Оплата заказа',
  OTHER_INCOME: 'Прочий доход',
  SALARY: 'Зарплата',
  BONUS: 'Премии',
  SUPPLIES: 'Расходные материалы',
  TRANSPORT: 'Транспорт',
  RENT: 'Аренда',
  MARKETING: 'Реклама и продвижение',
  BARTER: 'Бартер',
  TAX: 'Налоги и сборы',
  OTHER_EXPENSE: 'Прочий расход',
};

/** Какие статьи допустимы для дохода и для расхода — форма не даёт их перепутать */
export const CATEGORIES_BY_KIND: Record<FinanceKind, FinanceCategory[]> = {
  INCOME: ['ORDER_PAYMENT', 'OTHER_INCOME'],
  EXPENSE: [
    'SALARY',
    'BONUS',
    'SUPPLIES',
    'TRANSPORT',
    'RENT',
    'MARKETING',
    'BARTER',
    'TAX',
    'OTHER_EXPENSE',
  ],
};

// ── Журнал изменений (ТЗ 2) ──

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  CREATE: 'Создание',
  UPDATE: 'Изменение',
  DELETE: 'В корзину',
  RESTORE: 'Восстановление',
  PURGE: 'Удалено навсегда',
  STAGE_CHANGE: 'Смена этапа',
};

export const AUDIT_ACTION_COLOR: Record<AuditAction, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE: 'bg-sky-50 text-sky-700 border-sky-200',
  DELETE: 'bg-amber-50 text-amber-700 border-amber-200',
  RESTORE: 'bg-teal-50 text-teal-700 border-teal-200',
  PURGE: 'bg-rose-50 text-rose-700 border-rose-200',
  STAGE_CHANGE: 'bg-violet-50 text-violet-700 border-violet-200',
};

export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  ORDER: 'Заказ',
  CLIENT: 'Клиент',
  USER: 'Сотрудник',
  SHIFT_GROUP: 'Выезд',
  SHIFT: 'Смена',
  SERVICE: 'Услуга',
  TASK: 'Задача',
  CLEANER: 'Клинер',
  REPORT: 'Ведомость',
  FINANCE: 'Финансы',
  BONUS: 'Премия',
  PROPOSAL: 'КП',
  CHECKLIST: 'Чек-лист',
  REMINDER: 'Напоминание',
};

// ── Коммерческие предложения (ТЗ 9) ──

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: 'Черновик',
  SENT: 'Отправлено',
  ACCEPTED: 'Принято',
  REJECTED: 'Отклонено',
};

export const PROPOSAL_STATUS_COLOR: Record<ProposalStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  SENT: 'bg-sky-50 text-sky-700 border-sky-200',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
};

// ── Напоминания (ТЗ 10.1) ──

export const REMINDER_STATUS_LABEL: Record<ReminderStatus, string> = {
  PENDING: 'Ожидает',
  SENT: 'Напомнили',
  DONE: 'Выполнено',
  CANCELLED: 'Отменено',
};

export const REMINDER_STATUS_COLOR: Record<ReminderStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SENT: 'bg-sky-50 text-sky-700 border-sky-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
};

// ── Смены-выезды (ТЗ 4) ──

export const SHIFT_GROUP_STATUS_LABEL: Record<ShiftGroupStatus, string> = {
  PLANNED: 'Запланирован',
  IN_PROGRESS: 'В работе',
  CLOSED: 'Закрыт',
};

export const SHIFT_GROUP_STATUS_COLOR: Record<ShiftGroupStatus, string> = {
  PLANNED: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200',
  CLOSED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

// ── Корзина (ТЗ 1.3 и 6) ──

export const TRASH_TYPE_LABEL: Record<TrashType, string> = {
  order: 'Заказы',
  client: 'Клиенты',
  task: 'Задачи',
  cleaner: 'Клинеры',
  user: 'Сотрудники',
  report: 'Ведомости',
  financeEntry: 'Финансы',
  bonus: 'Премии',
  tariff: 'Услуги',
  extraService: 'Доп. услуги',
  proposal: 'КП',
  reminder: 'Напоминания',
  shiftGroup: 'Выезды',
};

/** Разделы корзины, которые видит только тот, кому доступны финансы */
export const TRASH_FINANCIAL_TYPES: TrashType[] = [
  'report',
  'financeEntry',
  'bonus',
];

// ── Человеческие подписи полей в истории изменений ──

export const AUDIT_FIELD_LABEL: Record<string, string> = {
  stage: 'Этап воронки',
  finalPrice: 'Итоговая сумма',
  estimatedPrice: 'Предварительная сумма',
  pricePerSqm: 'Цена за единицу',
  isManualPrice: 'Сумма задана вручную',
  area: 'Площадь',
  seats: 'Посадочных мест',
  address: 'Адрес',
  cleaners: 'Команда',
  members: 'Состав группы',
  managerId: 'Ответственный менеджер',
  preferences: 'Предпочтения',
  serviceKey: 'Услуга',
  cleaningType: 'Вид уборки',
  dirtLevel: 'Степень загрязнения',
  scheduledDate: 'Дата уборки',
  inspectionDate: 'Дата осмотра',
  rejectionReason: 'Причина отказа',
  fullName: 'ФИО',
  phone: 'Телефон',
  login: 'Логин',
  role: 'Роль',
  isActive: 'Активен',
  canManageOps: 'Видит базу всей компании',
  canManageTasks: 'Полный доступ к задачам',
  rate: 'Ставка',
  amount: 'Сумма',
  category: 'Статья',
  status: 'Статус',
  title: 'Название',
  passwordHash: 'Пароль',
};

export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABEL[field] ?? field;
}

/** Значение поля в истории: пустое — прочерк, дата — по-человечески */
export function formatAuditValue(value: string | null): string {
  if (value === null || value === '') return '—';
  if (value === '***') return 'скрыто';
  // ISO-дата → привычный формат
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  if (value === 'да' || value === 'нет') return value;
  return value;
}

// ─── Уведомления ───

/**
 * Куда ведёт уведомление из колокольчика.
 *
 * Уведомление без перехода — тупик: человек прочитал «статус заказа изменён»
 * и дальше ищет этот заказ руками. Поэтому каждый тип знает свою страницу, а
 * заказ и задача открываются адресно, по идентификатору из уведомления.
 */
export function notificationTarget(n: {
  type: NotificationKind;
  orderId?: string | null;
  taskId?: string | null;
  clientId?: string | null;
}): string | null {
  switch (n.type) {
    /*
     * Новая заявка ведёт в карточку клиента: с неё начинается работа с
     * обращением — там контакты, все заказы и история. Если клиент почему-то
     * не привязан, откатываемся к самой заявке в воронке.
     */
    case 'NEW_LEAD':
      return n.clientId
        ? `/clients/${n.clientId}`
        : n.orderId
          ? `/funnel?order=${n.orderId}`
          : '/funnel';
    case 'ORDER_STATUS_CHANGED':
    case 'ORDER_PREFERENCES':
      return n.orderId ? `/funnel?order=${n.orderId}` : '/funnel';
    case 'NEW_TASK':
    case 'TASK_STATUS_CHANGED':
      return '/tasks';
    case 'REMINDER_DUE':
    case 'REMINDER_ASSIGNED':
      return '/reminders';
    case 'REPORT_SENT':
    case 'REPORT_DRAFT_READY':
      return '/reports';
    case 'PROPOSAL_SENT':
      return '/offers';
    case 'CHECKLIST_DONE':
      return n.orderId ? `/funnel?order=${n.orderId}` : '/checklists';
    case 'SHIFT_CLOSED':
    case 'VISIT_PLANNED':
      return '/shifts';
    case 'BONUS_ACCRUED':
      return '/finance';
    default:
      return null;
  }
}
