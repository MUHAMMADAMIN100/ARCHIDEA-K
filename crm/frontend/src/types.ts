export type Role = 'DIRECTOR' | 'MANAGER';
export type LeadSource = 'SITE' | 'INSTAGRAM' | 'CALL' | 'RECOMMENDATION';
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
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
export type TaskType =
  | 'CALL'
  | 'INSPECTION'
  | 'VISIT'
  | 'MEETING'
  | 'PERSONAL';
export type ScheduleType = 'INSPECTION' | 'CLEANING_VISIT' | 'MEETING';
export type AccessMethod = 'KEYS' | 'ONSITE';

export interface AuthUser {
  id: string;
  login: string;
  fullName: string;
  role: Role;
  /** расширенный доступ: видит всё как директор, но без финансов */
  canManageOps?: boolean;
}

/** Видит ли пользователь данные всей компании (директор или ops-менеджер) */
export function userSeesAll(u?: AuthUser | null): boolean {
  return !!u && (u.role === 'DIRECTOR' || u.canManageOps === true);
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
}

export interface Cleaner {
  id: string;
  fullName: string;
  phone?: string;
  rate: number;
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
  rate: number;
  note?: string | null;
  cleaner?: {
    id: string;
    fullName: string;
    rate: number;
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
  total: number;
}

export interface PayrollSummary {
  rows: PayrollRow[];
  totals: { shifts: number; accrued: number; fines: number; total: number };
}

export interface Client {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  source: LeadSource;
  tags: ClientTag[];
  notes?: string;
  lastContactAt: string;
  managerId?: string;
  manager?: { id: string; fullName: string } | null;
  _count?: { orders: number };
  orders?: Order[];
}

export interface Order {
  id: string;
  clientId: string;
  managerId?: string;
  stage: FunnelStage;
  source: LeadSource;
  cleaningType: CleaningType;
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
  isLarge: boolean;
  createdAt: string;
  closedAt?: string | null;
  client?: { id: string; fullName: string; phone: string };
  manager?: { id: string; fullName: string } | null;
  cleaners?: { id: string; fullName: string }[];
}

export interface BoardColumn {
  stage: FunnelStage;
  label: string;
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

export interface ScheduleEvent {
  id: string;
  title: string;
  type: ScheduleType;
  date: string;
  note?: string;
  orderId?: string;
  managerId: string;
  manager?: { id: string; fullName: string };
}

export interface NotificationItem {
  id: string;
  type:
    | 'NEW_LEAD'
    | 'NEW_TASK'
    | 'TASK_STATUS_CHANGED'
    | 'ORDER_STATUS_CHANGED'
    | 'REPORT_SENT';
  title: string;
  message: string;
  isRead: boolean;
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
  revenueSeries?: { date: string; revenue: number }[];
  managerWorkload?: { id: string; name: string; active: number; paid: number }[];
}

export interface Tariff {
  id: string;
  key: CleaningType;
  title: string;
  pricePerSqm: number; // legacy = priceMedium
  priceLight: number;
  priceMedium: number;
  priceHeavy: number;
  hasLevels: boolean;
  unit: string; // «м²» или «место»
}

export interface Tariffs {
  tariffs: Tariff[];
  extras: { id: string; key: string; title: string; price: number; hasQty: boolean }[];
}
