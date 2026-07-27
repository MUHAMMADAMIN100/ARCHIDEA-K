import type {
  CleaningType,
  ClientTag,
  DirtLevel,
  FunnelStage,
  LeadSource,
  Order,
  ReportStatus,
  ScheduleType,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '../types';

export const STAGE_LABEL: Record<FunnelStage, string> = {
  NEW: 'Новая заявка',
  PROCESSING: 'Обработка',
  INSPECTION: 'Осмотр объекта',
  OFFER: 'Коммерческое предложение',
  CONFIRMED: 'Подтверждён',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнено',
  PAID: 'Оплачено / Закрыто',
  REJECTED: 'Отказ',
};

export const STAGE_ORDER: FunnelStage[] = [
  'NEW',
  'PROCESSING',
  'INSPECTION',
  'OFFER',
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
  RECOMMENDATION: 'Рекомендация',
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
};

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  LOW: 'bg-navy-100 text-navy-600',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-red-100 text-red-700',
};

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

/** Типы задач календаря (порядок = порядок кнопок фильтра и легенды) */
export const TASK_TYPE_ORDER: TaskType[] = [
  'CALL',
  'INSPECTION',
  'VISIT',
  'MEETING',
  'PERSONAL',
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

export const REPORT_STATUS_COLOR: Record<ReportStatus, string> = {
  DRAFT: 'bg-navy-100 text-navy-600',
  SENT: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-green-100 text-green-700',
};

export const SCHEDULE_LABEL: Record<ScheduleType, string> = {
  INSPECTION: 'Осмотр объекта',
  CLEANING_VISIT: 'Выезд команды',
  MEETING: 'Встреча',
};

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
