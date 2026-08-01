export type Role = 'DIRECTOR' | 'MANAGER';
export type LeadSource =
  | 'SITE'
  | 'INSTAGRAM'
  | 'CALL'
  | 'RECOMMENDATION'
  | 'ANISA';
export type FunnelStage =
  | 'NEW'
  | 'PROCESSING'
  | 'INSPECTION'
  | 'OFFER'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'PAID'
  | 'REJECTED';
export type CleaningType =
  | 'MAINTENANCE' // архив (старые заказы) — новая услуга не выбирается
  | 'GENERAL'
  | 'POST_RENOVATION'
  | 'FURNITURE';
export type DirtLevel = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type ClientTag = 'VIP' | 'REGULAR' | 'REFUSED' | 'POTENTIAL';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
export type TaskType =
  | 'CALL'
  | 'INSPECTION'
  | 'VISIT'
  | 'MEETING'
  | 'PERSONAL';
export type AccessMethod = 'KEYS' | 'ONSITE';

export interface AuthUser {
  id: string;
  login: string;
  fullName: string;
  role: Role;
  /** расширенный доступ: видит всё как директор, но без финансов */
  canManageOps?: boolean;
  /** ТЗ 1.2 — полный доступ к модулю задач (все задачи компании) */
  canManageTasks?: boolean;
  /** личный доступ к корзине (не следует из роли) */
  canSeeTrash?: boolean;
}

/**
 * Видит ли пользователь ДАННЫЕ всей компании (чужих клиентов, заказы, задачи).
 *
 * Не путать с доступом к РАЗДЕЛАМ: менеджер работает во всех разделах, кроме
 * финансовых, но клиентов и заказы видит только своих. Права на разделы —
 * это userManagesOps / userManagesCatalogs ниже (на бэкенде — permissions.ts).
 */
export function userSeesAll(u?: AuthUser | null): boolean {
  return !!u && (u.role === 'DIRECTOR' || u.canManageOps === true);
}

/**
 * Операционное управление: команда, бригады, выезды, учёт смен (право
 * `ops:manage`). Есть у каждого сотрудника компании — у бригады и выезда
 * нет владельца, «моих клинеров» не бывает.
 */
export function userManagesOps(u?: AuthUser | null): boolean {
  return !!u;
}

/**
 * Справочники компании: услуги и цены, шаблоны чек-листов и КП
 * (права `services:manage`, `checklists:manage`, `proposals:templates`).
 * Открыты всем сотрудникам — это рабочие инструменты, а не деньги компании.
 */
export function userManagesCatalogs(u?: AuthUser | null): boolean {
  return !!u;
}

/** Ведёт ли пользователь ВСЕ задачи компании, а не только свои (ТЗ 1.2) */
export function userManagesTasks(u?: AuthUser | null): boolean {
  return userSeesAll(u) || u?.canManageTasks === true;
}

/**
 * Книга доходов и расходов, премии — только руководитель.
 * Это деньги компании целиком, а не «свои» операции сотрудника.
 */
export function userSeesFinance(u?: AuthUser | null): boolean {
  return u?.role === 'DIRECTOR';
}

/**
 * Ops-менеджер: видит всё как директор, но БЕЗ денег.
 *
 * Отдельная проверка нужна там, где раздел закрыт именно от него, а обычному
 * менеджеру доступен — например, свои платёжные ведомости и выплаты.
 * Путать это с userSeesFinance нельзя: иначе менеджер, удаливший собственную
 * ведомость, не увидит её в корзине и не сможет восстановить.
 */
export function userIsOpsOnly(u?: AuthUser | null): boolean {
  return !!u && u.canManageOps === true && u.role !== 'DIRECTOR';
}

/**
 * Корзина — только руководителю и только с личным правом.
 *
 * Руководителей в компании несколько, но разбирать удалённое доверено
 * конкретным людям, поэтому мало быть руководителем — нужен ещё и флаг
 * в карточке сотрудника. Менеджерам раздел закрыт целиком (решение владельца).
 */
export function userSeesTrash(u?: AuthUser | null): boolean {
  return u?.canSeeTrash === true && u?.role === 'DIRECTOR';
}
export function userCanPurge(u?: AuthUser | null): boolean {
  return userSeesTrash(u);
}

export interface Manager {
  id: string;
  login: string;
  fullName: string;
  role: Role;
  phone?: string;
  position?: string | null;
  duties?: string | null;
  mainTask?: string | null;
  isActive: boolean;
  canManageOps?: boolean;
  canManageTasks?: boolean;
  acceptsLeads?: boolean;
  telegramChatId?: string | null;
  telegramEnabled?: boolean;
}

export interface Cleaner {
  id: string;
  fullName: string;
  phone?: string;
  /**
   * Ставка за смену. Приходит ТОЛЬКО тем, кому открыты финансы — остальным
   * сервер вырезает её из ответа (зарплата сотрудника не операционные данные).
   */
  rate?: number;
  duties?: string | null;
  isActive: boolean;
  managerId?: string;
  manager?: { id: string; fullName: string } | null;
  brigadeId?: string | null;
  brigade?: { id: string; name: string } | null;
}

export interface Brigade {
  id: string;
  name: string;
  leaderId?: string | null;
  leader?: { id: string; fullName: string } | null;
  cleaners: Cleaner[];
}

export interface Shift {
  id: string;
  date: string;
  cleanerId: string;
  /** Начисление за смену — приходит только при доступе к финансам */
  rate?: number;
  note?: string | null;
  /** выезд, который породил эту оплачиваемую смену (ТЗ 4) */
  groupId?: string | null;
  /** сам выезд — чтобы в расшифровке смены был виден адрес объекта */
  group?: {
    id: string;
    address: string;
    startTime?: string | null;
    endTime?: string | null;
    status: ShiftGroupStatus;
    brigadeName?: string | null;
  } | null;
  cleaner?: {
    id: string;
    fullName: string;
    rate?: number;
    brigade?: { id: string; name: string } | null;
  };
}

export interface Fine {
  id: string;
  cleanerId: string;
  amount: number;
  reason: string;
  date: string;
  cleaner?: {
    id: string;
    fullName: string;
    brigade?: { id: string; name: string } | null;
  };
}

export interface PayrollRow {
  cleanerId: string;
  fullName: string;
  rate: number;
  brigade?: string | null;
  brigadeId?: string | null;
  shifts: number;
  accrued: number;
  fines: number;
  /** ТЗ 7.2 — начисленные премии за период */
  bonuses?: number;
  total: number;
  isActive?: boolean;
}

export interface PayrollSummary {
  rows: PayrollRow[];
  totals: {
    shifts: number;
    accrued: number;
    fines: number;
    bonuses?: number;
    total: number;
  };
}

export interface Client {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  source: LeadSource;
  tags: ClientTag[];
  notes?: string;
  /** ТЗ 10.2 — постоянные предпочтения клиента */
  preferences?: string | null;
  /** Постоянная скидка клиента в сомони — подставляется в новые заказы */
  discount?: number;
  /** Запасные номера «на всякий случай» */
  extraPhones?: string[];
  /** Свободные теги для сегментации — в дополнение к единственному статусу */
  labels?: string[];
  /** «От кого» пришёл клиент — рекомендатель или партнёр */
  sourceDetail?: string | null;
  lastContactAt: string;
  managerId?: string;
  manager?: { id: string; fullName: string } | null;
  _count?: { orders: number };
  orders?: Order[];
  // ── Повторный клиент (ТЗ 9.4) ──
  isRepeat?: boolean;
  paidOrdersCount?: number;
  lastOrderAt?: string | null;
  deletedAt?: string | null;
}

export interface Order {
  id: string;
  clientId: string;
  managerId?: string;
  stage: FunnelStage;
  source: LeadSource;
  cleaningType: CleaningType;
  /** ключ услуги (ТЗ 1.1) — может быть услугой, заведённой директором */
  serviceKey?: string | null;
  dirtLevel?: DirtLevel | null;
  area: number;
  seats?: number | null;
  address?: string;
  estimatedPrice: number;
  pricePerSqm?: number | null;
  finalPrice?: number | null;
  preferences?: string | null;
  preferredDate?: string | null;
  preferredTime?: string | null;
  hasUtilities?: boolean | null;
  accessMethod?: AccessMethod | null;
  comment?: string | null;
  rejectionReason?: string | null;
  inspectionDate?: string | null;
  scheduledDate?: string | null;
  /** ТЗ 5 — сумма задана вручную, автоматический пересчёт её не трогает */
  isManualPrice?: boolean;
  /** Выбранные доп. услуги: ключ услуги → количество */
  extras?: Record<string, number> | null;
  /** Скидка по заказу в сомони */
  discount?: number;
  /** Сколько клиент уже заплатил, сомони. Остаток = итог − эта сумма */
  paidAmount?: number;
  /** Дополнительные основные услуги заявки (мульти-выбор) — снапшот строк */
  additionalServices?:
    | {
        key: string;
        title: string;
        unit: string;
        qty: number;
        pricePerUnit: number;
        total: number;
      }[]
    | null;
  /** «От кого» пришла заявка */
  sourceDetail?: string | null;
  isLarge: boolean;
  createdAt: string;
  closedAt?: string | null;
  deletedAt?: string | null;
  client?: {
    id: string;
    fullName: string;
    phone: string;
    extraPhones?: string[];
    /** статус клиента — показывается в углу карточки воронки */
    tags?: ClientTag[];
    /** свободные теги клиента — там же, рядом со статусом */
    labels?: string[];
    preferences?: string | null;
    isRepeat?: boolean;
    paidOrdersCount?: number;
  };
  manager?: { id: string; fullName: string } | null;
  cleaners?: { id: string; fullName: string }[];
  /** ТЗ 3.2 — выезды по заказу: кто, когда и куда ездил */
  shiftGroups?: ShiftGroupBrief[];
}

export interface BoardColumn {
  stage: FunnelStage;
  label: string;
  /** Сумма денег на этапе — считает сервер по итоговой или расчётной цене */
  amount?: number;
  orders: Order[];
}

/** Исполнитель задачи со своим статусом */
export interface TaskAssignment {
  id: string;
  userId: string;
  status: TaskStatus;
  user: { id: string; fullName: string };
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus; // сводный статус (по всем исполнителям)
  deadline?: string | null;
  assigneeId: string;
  creatorId: string;
  assignee: { id: string; fullName: string };
  creator: { id: string; fullName: string };
  /** Всегда непустой: для старых задач бэкенд подставляет основного исполнителя */
  assignments: TaskAssignment[];
  createdAt: string;
}

/** Держать в согласии с enum NotificationType на бэкенде */
export type NotificationKind =
  | 'NEW_LEAD'
  | 'NEW_TASK'
  | 'TASK_STATUS_CHANGED'
  | 'ORDER_STATUS_CHANGED'
  | 'REPORT_SENT'
  | 'ORDER_PREFERENCES'
  | 'REMINDER_DUE'
  | 'REMINDER_ASSIGNED'
  | 'PROPOSAL_SENT'
  | 'CHECKLIST_DONE'
  | 'SHIFT_CLOSED'
  | 'VISIT_PLANNED'
  | 'BONUS_ACCRUED'
  | 'REPORT_DRAFT_READY';

export interface NotificationItem {
  id: string;
  type: NotificationKind;
  title: string;
  message: string;
  isRead: boolean;
  /** заполнены, когда уведомление привязано к заказу, задаче или клиенту */
  orderId?: string | null;
  taskId?: string | null;
  clientId?: string | null;
  createdAt: string;
}

// ─── Платёжные ведомости (отчёты по объектам) ───

export type ReportStatus = 'DRAFT' | 'SENT' | 'ACCEPTED';

export interface ReportWorker {
  id?: string;
  cleanerId?: string | null;
  fullName: string;
  role: string; // «Бригадир» / «Клинер»
  days: number;
  rate: number;
  fine: number;
  extra: number;
}

export interface ReportExpense {
  id?: string;
  title: string;
  initiator?: string | null;
  amount: number;
  comment?: string | null;
}

export interface Report {
  id: string;
  status: ReportStatus;
  orderId?: string | null;
  clientName: string;
  clientPhone?: string | null;
  address?: string | null;
  workDate?: string | null;
  workEndDate?: string | null;
  unitsLabel?: string | null;
  extraServices?: string | null;
  discount: number;
  totalPrice: number;
  arrivedBy?: string | null;
  brigadierName?: string | null;
  managerName?: string | null;
  managerId: string;
  manager?: { id: string; fullName: string };
  sentAt?: string | null;
  acceptedAt?: string | null;
  workers: ReportWorker[];
  expenses: ReportExpense[];
  createdAt: string;
}

export interface Analytics {
  byType: { type: CleaningType; label: string; count: number }[];
  sources: { source: LeadSource; label: string; count: number }[];
  conversion: { total: number; paid: number; rejected: number; rate: number };
  revenue?: { day: number; week: number; month: number; quarter: number };
  /** date — подпись оси («07-28»), day — полная дата для расшифровки столбика */
  revenueSeries?: { date: string; day: string; revenue: number }[];
  managerWorkload?: { id: string; name: string; active: number; paid: number }[];
}

export interface Tariff {
  id: string;
  /** строка, а не перечисление: директор заводит новые услуги (ТЗ 1.1) */
  key: string;
  title: string;
  description?: string | null;
  pricePerSqm: number; // legacy = priceMedium
  priceLight: number;
  priceMedium: number;
  priceHeavy: number;
  hasLevels: boolean;
  unit: string; // «м²», «место», «шт»
  /** базовая услуга: ключ и единицу менять нельзя, удалять нельзя */
  isSystem?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ExtraService {
  id: string;
  key: string;
  title: string;
  price: number;
  hasQty: boolean;
  isSystem?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface Tariffs {
  tariffs: Tariff[];
  extras: ExtraService[];
}

// ═══════════════════════════════════════════════════════════
//  Смены-выезды (ТЗ 4)
// ═══════════════════════════════════════════════════════════

export type ShiftGroupStatus = 'PLANNED' | 'IN_PROGRESS' | 'CLOSED';

export interface ShiftGroupMember {
  id: string;
  /** null — разовый клинер (замена), не заведённый в базе */
  cleanerId: string | null;
  fullName: string;
  role: string; // «Бригадир» / «Клинер» / «Разовый»
  rate?: number;
}

/** Краткий вид выезда — то, что показывается в карточке заказа */
export interface ShiftGroupBrief {
  id: string;
  date: string;
  address: string;
  startTime?: string | null;
  endTime?: string | null;
  status: ShiftGroupStatus;
  brigadeName?: string | null;
  brigadierName?: string | null;
  managerName?: string | null;
  closedAt?: string | null;
  members: ShiftGroupMember[];
}

export interface ShiftGroup extends ShiftGroupBrief {
  orderId?: string | null;
  brigadeId?: string | null;
  brigadierId?: string | null;
  managerId?: string | null;
  note?: string | null;
  closedByName?: string | null;
  order?: {
    id: string;
    address?: string | null;
    client?: { id: string; fullName: string; phone: string } | null;
  } | null;
  shifts?: { id: string; cleanerId: string; rate: number }[];
  createdAt?: string;
  deletedAt?: string | null;
}

// ═══════════════════════════════════════════════════════════
//  Финансы (ТЗ 7)
// ═══════════════════════════════════════════════════════════

export type FinanceKind = 'INCOME' | 'EXPENSE';
export type FinanceSource = 'AUTO' | 'MANUAL';
export type FinanceCategory =
  | 'ORDER_PAYMENT'
  | 'OTHER_INCOME'
  | 'SALARY'
  | 'BONUS'
  | 'SUPPLIES'
  | 'TRANSPORT'
  | 'RENT'
  | 'MARKETING'
  | 'BARTER'
  | 'TAX'
  | 'OTHER_EXPENSE';

export interface FinanceEntry {
  id: string;
  kind: FinanceKind;
  category: FinanceCategory;
  amount: number;
  date: string;
  title: string;
  comment?: string | null;
  source: FinanceSource;
  orderId?: string | null;
  clientId?: string | null;
  shiftGroupId?: string | null;
  createdByName?: string | null;
  createdAt: string;
  order?: { id: string; client?: { fullName: string } | null } | null;
}

export interface FinanceSummary {
  income: number;
  expense: number;
  profit: number;
  byCategory: {
    category: FinanceCategory;
    label: string;
    kind: FinanceKind;
    amount: number;
  }[];
  /** date — ключ месяца «ГГГГ-ММ»: по нему открывается расшифровка столбика */
  series?: { date: string; income: number; expense: number }[];
}

/** Премия — только ручное начисление (ТЗ 7.2) */
export interface Bonus {
  id: string;
  cleanerId?: string | null;
  userId?: string | null;
  recipientName: string;
  amount: number;
  reason: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  createdByName: string;
  paidAt?: string | null;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
//  Журнал изменений (ТЗ 2)
// ═══════════════════════════════════════════════════════════

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'RESTORE'
  | 'PURGE'
  | 'STAGE_CHANGE';

export interface AuditChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  entityTitle: string;
  action: AuditAction;
  summary?: string | null;
  changes?: AuditChange[] | null;
  actorId?: string | null;
  actorName: string;
  createdAt: string;
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

// ═══════════════════════════════════════════════════════════
//  Чек-листы (ТЗ 8)
// ═══════════════════════════════════════════════════════════

export type ChecklistStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';

/** Оценка загрязнения при приёме объекта — как в бумажном чек-листе */
export type DirtAssessment = 'NORMAL' | 'MEDIUM' | 'HEAVY';

export interface ChecklistTemplateItem {
  id: string;
  title: string;
  /** Пояснение под пунктом: на что смотреть и почему это важно */
  hint?: string | null;
  section?: string | null;
  required: boolean;
  sortOrder: number;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description?: string | null;
  /** Пункты оцениваются по шкале, а не отмечаются галочкой */
  usesLevels?: boolean;
  cleaningType?: CleaningType | null;
  serviceKey?: string | null;
  isActive: boolean;
  items: ChecklistTemplateItem[];
  createdAt?: string;
}

export interface OrderChecklistItem extends ChecklistTemplateItem {
  isDone: boolean;
  level?: DirtAssessment | null;
  doneById?: string | null;
  doneByName?: string | null;
  doneAt?: string | null;
  comment?: string | null;
}

export interface OrderChecklist {
  id: string;
  orderId: string;
  templateId?: string | null;
  templateName: string;
  usesLevels?: boolean;
  note?: string | null;
  status: ChecklistStatus;
  completedAt?: string | null;
  items: OrderChecklistItem[];
}

// ═══════════════════════════════════════════════════════════
//  Коммерческие предложения (ТЗ 9)
// ═══════════════════════════════════════════════════════════

export type ProposalStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';

export interface ProposalTemplate {
  id: string;
  name: string;
  intro?: string | null;
  body: string;
  conditions?: string | null;
  validDays: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
}

export interface ProposalItem {
  title: string;
  volume?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
}

export interface Proposal {
  id: string;
  number: number;
  status: ProposalStatus;
  clientId: string;
  orderId?: string | null;
  templateId?: string | null;
  templateName: string;
  clientName: string;
  clientPhone?: string | null;
  address?: string | null;
  area?: number | null;
  pricePerSqm?: number | null;
  total: number;
  discount: number;
  items?: ProposalItem[] | null;
  bodySnapshot: string;
  validUntil?: string | null;
  /** ТЗ 9.2 — кто отправил КП клиенту */
  sentByName?: string | null;
  sentAt?: string | null;
  createdByName: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
//  Напоминания (ТЗ 10.1)
// ═══════════════════════════════════════════════════════════

export type ReminderStatus = 'PENDING' | 'SENT' | 'DONE' | 'CANCELLED';
export type ReminderSource = 'MANUAL' | 'PREORDER';

export interface Reminder {
  id: string;
  clientId: string;
  orderId?: string | null;
  title: string;
  note?: string | null;
  remindAt: string;
  status: ReminderStatus;
  source: ReminderSource;
  assigneeId: string;
  assigneeName: string;
  createdByName: string;
  sentAt?: string | null;
  doneAt?: string | null;
  createdAt: string;
  client?: { id: string; fullName: string; phone: string } | null;
}

export interface ReminderCounts {
  pending: number;
  overdue: number;
}

// ═══════════════════════════════════════════════════════════
//  Корзина (ТЗ 1.3 и 6)
// ═══════════════════════════════════════════════════════════

export type TrashType =
  | 'order'
  | 'client'
  | 'task'
  | 'cleaner'
  | 'user'
  | 'report'
  | 'financeEntry'
  | 'bonus'
  | 'tariff'
  | 'extraService'
  | 'proposal'
  | 'reminder'
  | 'shiftGroup';

export interface TrashItem {
  type: TrashType;
  id: string;
  title: string;
  subtitle?: string | null;
  deletedAt: string;
  deletedBy?: string | null;
  deleteReason?: string | null;
  purgeAt?: string | null;
}

export type TrashCounts = Partial<Record<TrashType, number>> & { total: number };

// ═══════════════════════════════════════════════════════════
//  Аналитика за период — GET /analytics/full (ТЗ 3.3)
// ═══════════════════════════════════════════════════════════

export type AnalyticsPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';

/**
 * Ответ `/analytics/full`. В отличие от старой сводки дашборда здесь ВСЕ
 * разрезы (воронка, типы уборки, источники, выручка) посчитаны за ОДИН И ТОТ
 * ЖЕ период — `period`/`from`/`to` описывают его границы. Раньше конверсия
 * считалась за всю историю, а выручка — за выбранный период, из-за чего
 * цифры на одном экране не сходились между собой.
 */
/** Разрезы аналитики за выбранный период — все строки кликабельны */
export interface AnalyticsBreakdowns {
  managers: {
    id: string | null;
    name: string;
    /** обращений за период */
    total: number;
    /** из них оплачено */
    paid: number;
    amount: number;
    average: number;
  }[];
  services: { key: string; label: string; count: number; amount: number }[];
  extras: { key: string; label: string; count: number; amount: number }[];
  brigades: {
    id: string | null;
    name: string;
    leader: string | null;
    visits: number;
    shifts: number;
    accrued: number;
  }[];
  cleaners: { id: string; name: string; shifts: number; accrued: number }[];
  clients: { id: string; name: string; count: number; amount: number }[];
  sourceRows: {
    source: string;
    label: string;
    total: number;
    paid: number;
    amount: number;
  }[];
  totals: {
    paidOrders: number;
    revenue: number;
    average: number;
    discountTotal: number;
    extrasRevenue: number;
  };
}

export interface AnalyticsFull extends Omit<Analytics, 'revenue'> {
  period: AnalyticsPeriod;
  from: string | null;
  to: string | null;
  revenue?: {
    day: number;
    week: number;
    month: number;
    quarter: number;
    /** выручка ровно за выбранный период — то, с чем нужно сверять остальные разрезы */
    period: number;
  };
  /** Разрезы: менеджеры, услуги, бригады, клиенты, источники */
  breakdowns?: AnalyticsBreakdowns;
  /** Сверка: расхождения должны быть видны сразу, а не теряться в цифрах */
  reconciliation?: {
    paidOrdersInPeriod: number;
    ordersWithoutPrice: number;
    paidWithoutCloseDate: number;
  };
}

/** Заказ в расшифровке аналитики — ровно те поля, что нужны списку */
export interface DrilldownOrder {
  id: string;
  createdAt: string;
  closedAt?: string | null;
  stage: FunnelStage;
  source: LeadSource;
  cleaningType: CleaningType;
  address?: string | null;
  area: number;
  estimatedPrice: number;
  finalPrice?: number | null;
  price: number;
  typeLabel: string;
  sourceLabel: string;
  client: { id: string; fullName: string; phone: string };
  manager?: { id: string; fullName: string } | null;
}

/** Ответ /analytics/drilldown — из чего сложилась цифра на экране */
export interface AnalyticsDrilldown {
  metric: string;
  key: string | null;
  count: number;
  sum: number;
  orders: DrilldownOrder[];
}

// ═══════════════════════════════════════════════════════════
//  Довесок к ShiftGroup — архивный слепок при закрытии (ТЗ 4)
// ═══════════════════════════════════════════════════════════

/** Неизменяемая копия данных выезда на момент закрытия смены */
export interface ShiftGroupSnapshot {
  address: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  brigadeName?: string | null;
  brigadierName?: string | null;
  managerName?: string | null;
  orderId?: string | null;
  members: { cleanerId: string | null; fullName: string; role: string; rate: number }[];
}

export interface ShiftGroup {
  closedSnapshot?: ShiftGroupSnapshot | null;
}
