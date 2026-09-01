export type Role = 'DIRECTOR' | 'SUPERVISOR' | 'MANAGER';

/** Как роль называется по-русски — одинаково во всех разделах */
export const ROLE_TITLE: Record<Role, string> = {
  DIRECTOR: 'Руководитель',
  SUPERVISOR: 'Управляющий',
  MANAGER: 'Менеджер',
};
export type LeadSource =
  | 'SITE'
  | 'INSTAGRAM'
  | 'CALL'
  | 'COLD_CALL'
  | 'RECOMMENDATION'
  | 'ANISA';

/** Каким вышел разговор с клиентом — по нему считают работу менеджеров */
export type CallType = 'COLD' | 'NEUTRAL' | 'HOT';

/** Назначенный перезвон — отметка «позвонить» в календаре */
export interface Callback {
  id: string;
  fullName: string;
  phone: string;
  callbackAt: string | null;
  callType?: CallType | null;
  interestLevel?: string | null;
  manager?: { id: string; fullName: string } | null;
}
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
  /** персональный запрет на финансы — сильнее роли */
  noFinance?: boolean;
  /** Персональный доступ к ведомостям — сильнее запрета на финансы */
  canSeeReports?: boolean;
  /** владелец компании: единственный, кто может удалять сотрудников */
  isOwner?: boolean;
}

/**
 * Видит ли пользователь ДАННЫЕ всей компании (чужих клиентов, заказы, задачи).
 *
 * Не путать с доступом к РАЗДЕЛАМ: менеджер работает во всех разделах, кроме
 * финансовых, но клиентов и заказы видит только своих. Права на разделы —
 * это userManagesOps / userManagesCatalogs ниже (на бэкенде — permissions.ts).
 */
export function userSeesAll(u?: AuthUser | null): boolean {
  return (
    !!u &&
    (u.role === 'DIRECTOR' || u.role === 'SUPERVISOR' || u.canManageOps === true)
  );
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
/**
 * Персональный запрет на деньги компании — сильнее любой роли.
 *
 * Отличается от userSeesFinance: книга доходов менеджеру не положена по роли,
 * а платёжные ведомости он ведёт — это его работа. Сотруднику же, которому
 * владелец закрыл деньги, закрыты и ведомости: там и цена заказа, и выплаты
 * работникам.
 */
export function userFinanceBanned(u?: AuthUser | null): boolean {
  return u?.noFinance === true;
}

/**
 * Видит ли сотрудник платёжные ведомости.
 *
 * Ведомость — рабочий документ (бригада, объект, выплаты за смену), а не
 * книга доходов компании. Поэтому запрет «без доступа к финансам» здесь
 * перебивается персональной галочкой: владелец открывает ведомости
 * конкретному человеку, не открывая ему прибыль и расходы.
 */
export function userSeesReports(u?: AuthUser | null): boolean {
  if (!u) return false;
  // у управляющего ведомости — часть работы: он ведёт выезды и выплаты
  // бригадам и отправляет отчёты руководству
  if (u.role === 'SUPERVISOR') return true;
  return !u.noFinance || u.canSeeReports === true;
}

export function userSeesFinance(u?: AuthUser | null): boolean {
  /*
   * Персональный запрет сильнее роли: у руководителя с галочкой «без доступа
   * к финансам» деньги закрыты так же, как у менеджера. Проверка стоит первой,
   * чтобы никакая роль её не перебила.
   */
  if (u?.noFinance) return false;
  // управляющий ведёт книгу доходов и расходов наравне с руководителем
  // (решение владельца)
  return u?.role === 'DIRECTOR' || u?.role === 'SUPERVISOR';
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
  /** «От кого» пришёл клиент — рекомендатель или партнёр */
  sourceDetail?: string | null;
  /** Адрес клиента — подставляется в новые заказы */
  address?: string | null;
  // ── Холодные звонки ──
  /** Каким вышел последний разговор */
  callType?: CallType | null;
  /** Когда перезвонить — в календаре встаёт отметка «позвонить» */
  callbackAt?: string | null;
  /** Степень заинтересованности: «Перезвоню», «Подумаю» и свои варианты */
  interestLevel?: string | null;
  lastContactAt: string;
  managerId?: string;
  manager?: { id: string; fullName: string } | null;
  _count?: { orders: number };
  orders?: Order[];
  /** Встречи и звонки, назначенные по клиенту */
  tasks?: {
    id: string;
    title: string;
    type: TaskType;
    status: TaskStatus;
    deadline?: string | null;
    assignee?: { id: string; fullName: string } | null;
  }[];
  // ── Повторный клиент (ТЗ 9.4) ──
  isRepeat?: boolean;
  paidOrdersCount?: number;
  lastOrderAt?: string | null;
  deletedAt?: string | null;
}

/** Чем заплатил клиент (ТЗ 3.1). null — старые записи, тогда способ не спрашивали */
export type PaymentMethod = 'CASH' | 'BANK';

/** Один взнос по заказу */
export interface OrderPayment {
  id: string;
  amount: number;
  method: PaymentMethod | null;
  note?: string | null;
  paidAt: string;
  createdByName?: string | null;
  bank?: { id: string; title: string } | null;
}

/** Банк из справочника — для безналичной оплаты */
export interface PaymentBank {
  id: string;
  key: string;
  title: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder?: number;
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
  /** последний день, если уборка идёт не один день */
  scheduledEndDate?: string | null;
  /** ТЗ 5 — сумма задана вручную, автоматический пересчёт её не трогает */
  isManualPrice?: boolean;
  /** Выбранные доп. услуги: ключ услуги → количество */
  extras?: Record<string, number> | null;
  /** Свои доп. услуги строками: в сумму идут только отмеченные */
  customExtras?: { title: string; price: number; checked: boolean }[] | null;
  /** Скидка по заказу в сомони */
  discount?: number;
  /** Сколько клиент уже заплатил, сомони. Считается из взносов, вручную не задаётся */
  paidAmount?: number;
  /** Внесённые оплаты: чем, когда и сколько (ТЗ 3.1) */
  payments?: OrderPayment[];
  /** Разовые сотрудники под заказ: кого позвали и сколько отдали */
  guestCleaners?: { fullName: string; rate: number }[] | null;
  /** Состав по дням со 2-го; нет записи — весь состав заказа */
  dayTeams?: { day: number; cleanerIds: string[] }[] | null;
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
  /**
   * Ведомость по заказу — самая свежая, одной строкой.
   *
   * Нужна прямо на карточке воронки: по закрытым заказам владелец
   * отчитывается ведомостями, и «разобран или нет» должно быть видно
   * без открытия каждого заказа.
   */
  reports?: { id: string; status: ReportStatus }[];
  createdAt: string;
  closedAt?: string | null;
  /** Когда запись появилась в системе — от неё считается переезд в архив */
  registeredAt?: string | null;
  deletedAt?: string | null;
  client?: {
    id: string;
    fullName: string;
    phone: string;
    extraPhones?: string[];
    /** статус клиента — показывается в углу карточки воронки */
    tags?: ClientTag[];
    /** постоянная скидка клиента — подставляется в заказ, если своя не задана */
    discount?: number;
    preferences?: string | null;
    isRepeat?: boolean;
    paidOrdersCount?: number;
    /** Сколько всего раз клиент обращался — по нему мигает точка «повторный» */
    ordersTotal?: number;
  };
  manager?: { id: string; fullName: string } | null;
  cleaners?: { id: string; fullName: string }[];
  /** ТЗ 3.2 — выезды по заказу: кто, когда и куда ездил */
  shiftGroups?: ShiftGroupBrief[];
}

export interface BoardColumn {
  stage: FunnelStage;
  label: string;
  /** Сколько закрытых заказов этапа лежит в папке «Архив» (в колонке — не больше 20) */
  archived?: number;
  /** Полная стоимость заказов этапа — сколько на нём заработано */
  amount?: number;
  /** Сколько из этой суммы ещё не получено (недоплата по начатым заказам) */
  debt?: number;
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
  /** Клиент, к которому относится задача (встреча, звонок, выезд) */
  clientId?: string | null;
  client?: {
    id: string;
    fullName: string;
    phone: string;
    /** последний заказ клиента — из него берём адрес объекта */
    orders?: { address?: string | null }[];
  } | null;
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
  /**
   * Заказ, по которому составлена ведомость. Даты уборки нужны, чтобы
   * сверить проставленные в строках дни с длительностью самого заказа.
   */
  order?: {
    id: string;
    cleaningType?: CleaningType;
    area?: number | null;
    seats?: number | null;
    scheduledDate?: string | null;
    scheduledEndDate?: string | null;
    /** назначенная на заказ команда — по ней видно, кого нет в ведомости */
    cleaners?: {
      id: string;
      fullName: string;
      rate?: number;
      leaderOf?: { id: string } | null;
    }[];
    /** разовые сотрудники заказа: имя и отданная на руки сумма */
    guestCleaners?: { fullName: string; rate: number }[] | null;
    /** состав по дням со 2-го — дни работникам считаются по нему */
    dayTeams?: { day: number; cleanerIds: string[] }[] | null;
  } | null;
}

export interface Analytics {
  byType: { type: CleaningType; label: string; count: number }[];
  sources: { source: LeadSource; label: string; count: number }[];
  conversion: { total: number; paid: number; rejected: number; rate: number };
  revenue?: {
    day: number;
    week: number;
    month: number;
    quarter: number;
    period: number;
    /** все расходы из книги за период и чистый доход (выручка − расходы) */
    expenses: number;
    net: number;
  };
  /** date — подпись оси («07-28»), day — полная дата для расшифровки столбика */
  revenueSeries?: { date: string; day: string; revenue: number; expense: number; net: number }[];
  /** зарплаты за период — только тем, кому открыты финансы */
  payroll?: { cleanersAccrued: number; staffPay: number };
  managerWorkload?: { id: string; name: string; active: number; paid: number }[];
  /** KPI по каждому менеджеру за выбранный период */
  managerKpi?: {
    id: string | null;
    name: string;
    calls: number;
    cold: number;
    neutral: number;
    hot: number;
    newClients: number;
    orders: number;
    paid: number;
    rejected: number;
    amount: number;
    conversion: number;
  }[];
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
  /** Что входит в услугу и что не входит (ТЗ: объём работ) */
  includedWorks?: string[];
  excludedWorks?: string[];
  /** Выработка: сколько единиц успевает один человек за смену */
  outputPerDay?: number | null;
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
  | 'UTILITIES'
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
  /** Чем получены деньги (ТЗ 3.1). У расходов и старых записей пусто */
  paymentMethod?: PaymentMethod | null;
  bank?: { id: string; title: string } | null;
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
  /** Раздел сметы: «Работы», «Дополнительные услуги» (ТЗ 9) */
  section?: string | null;
  /** Единица объёма: м², место, шт */
  unit?: string | null;
  /** Что входит в услугу — построчно, из справочника услуг */
  includes?: string[] | null;
  /** Срок работ и число людей: «Планируемая сдача работы 5 дней…» */
  note?: string | null;
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
  /** итог по всем клиентам периода — в таблице показан только топ */
  clientsTotal?: { clients: number; count: number; amount: number };
  /** итог по всем клинерам периода — в таблице показаны первые 30 */
  cleanersTotal?: { cleaners: number; shifts: number; accrued: number };
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
    expenses: number;
    net: number;
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
