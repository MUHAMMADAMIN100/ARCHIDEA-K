import { BadRequestException } from '@nestjs/common';
import { FunnelStage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatDate, formatDateTime } from '../common/time/dushanbe';
import { AuditEntity } from '../audit/audit.types';

/**
 * Клиент Prisma или транзакция. purgeGuard вызывается и как самостоятельная
 * проверка (список/одиночное удаление), и внутри `$transaction` (массовая
 * очистка) — чтобы проверка и само удаление видели одни и те же данные.
 */
export type TrashDb = PrismaService | Prisma.TransactionClient;

/**
 * Единый реестр типов корзины (ТЗ 1.3 / 6).
 *
 * Каждая запись описывает ОДНУ модель Prisma: как её найти (имя делегата
 * PrismaService совпадает с именем типа — это специально выбрано при
 * проектировании, чтобы не городить отдельную таблицу соответствий),
 * как показать её в списке, кого она касается (scope) и что проверить
 * перед безвозвратным удалением.
 */
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

export const TRASH_TYPES: TrashType[] = [
  'order',
  'client',
  'task',
  'cleaner',
  'user',
  'report',
  'financeEntry',
  'bonus',
  'tariff',
  'extraService',
  'proposal',
  'reminder',
  'shiftGroup',
];

/** Правило мягкого каскада: при удалении/восстановлении родителя трогаем и детей */
export interface TrashCascadeRule {
  /** Тип-ребёнок из этого же реестра (совпадает с именем делегата PrismaService) */
  type: TrashType;
  /** Поле внешнего ключа у ребёнка, указывающее на родителя */
  fk: string;
}

export interface TrashEntry {
  /** Имя модели Prisma — для читаемости и сверки со схемой */
  model: Prisma.ModelName;
  /** Сущность в журнале изменений (audit.types.ts) */
  entity: AuditEntity;
  /** Человеческая метка раздела */
  label: string;
  /** Финансовый раздел — скрывается от ops-менеджера (NoOpsFinanceGuard) */
  financial: boolean;
  /** Заголовок строки в списке корзины */
  title(row: any): string;
  /** Подзаголовок строки в списке корзины */
  subtitle(row: any): string;
  /** include для запроса — только то, что нужно для title/subtitle */
  include?: Record<string, unknown>;
  /** where-условие поиска по строке (используется в GET /trash?search=) */
  search(term: string): Record<string, unknown>;
  /**
   * Чьей записью считается объект для обычного менеджера — используется как
   * `OR: [ownerWhere(userId), { deletedById: userId }]`. null — у модели нет
   * понятия «владельца», кроме факта, что удалил именно этот пользователь.
   */
  ownerWhere: ((userId: string) => Record<string, unknown>) | null;
  /** Дети для мягкого каскада: soft-delete/restore родителя переносится на них */
  cascade?: TrashCascadeRule[];
  /** Проверка перед безвозвратным удалением — бросает исключение при запрете */
  purgeGuard?: (db: TrashDb, id: string) => Promise<void>;
}

const STAGE_LABEL: Record<FunnelStage, string> = {
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

const containsInsensitive = (term: string) => ({
  contains: term,
  mode: 'insensitive' as const,
});

export const TRASH_REGISTRY: Record<TrashType, TrashEntry> = {
  order: {
    model: 'Order',
    entity: 'ORDER',
    label: 'Заказ',
    financial: false,
    include: { client: { select: { fullName: true, phone: true } } },
    title: (row) => `Заказ — ${row.client?.fullName ?? 'без клиента'}`,
    subtitle: (row) =>
      `${STAGE_LABEL[row.stage as FunnelStage] ?? row.stage} · ${
        row.finalPrice ?? row.estimatedPrice ?? 0
      } сомони`,
    search: (term) => ({
      OR: [
        { address: containsInsensitive(term) },
        { client: { fullName: containsInsensitive(term) } },
        { client: { phone: { contains: term } } },
      ],
    }),
    ownerWhere: (userId) => ({ managerId: userId }),
    cascade: [
      { type: 'proposal', fk: 'orderId' },
      { type: 'reminder', fk: 'orderId' },
      /*
       * Доход по заказу уходит в корзину и возвращается ВМЕСТЕ с ним.
       * Без этого удалённый оплаченный заказ пропадал из воронки и аналитики,
       * но оставался в книге доходов — прибыль компании завышалась.
       */
      { type: 'financeEntry', fk: 'orderId' },
    ],
    // ShiftGroup и OrderChecklist на заказ отвязываются или каскадируются самой
    // БД (SetNull/Cascade в схеме) — доп. проверка не нужна.
  },

  client: {
    model: 'Client',
    entity: 'CLIENT',
    label: 'Клиент',
    financial: false,
    title: (row) => row.fullName,
    subtitle: (row) => row.phone ?? '',
    search: (term) => ({
      OR: [
        { fullName: containsInsensitive(term) },
        { phone: { contains: term } },
      ],
    }),
    ownerWhere: (userId) => ({ managerId: userId }),
    cascade: [
      { type: 'order', fk: 'clientId' },
      { type: 'proposal', fk: 'clientId' },
      { type: 'reminder', fk: 'clientId' },
    ],
    purgeGuard: async (prisma, id) => {
      // Order.client — Cascade: безвозвратное удаление клиента сотрёт заказы
      // физически. Разрешаем это только когда ВСЕ заказы клиента уже в корзине —
      // иначе директор мог случайно стереть активную историю продаж.
      const activeOrders = await prisma.order.count({
        where: { clientId: id, deletedAt: null },
      });
      if (activeOrders > 0) {
        throw new BadRequestException(
          'Сначала удалите заказы клиента — у него есть активные заказы',
        );
      }
    },
  },

  task: {
    model: 'Task',
    entity: 'TASK',
    label: 'Задача',
    financial: false,
    include: { assignee: { select: { fullName: true } } },
    title: (row) => row.title,
    subtitle: (row) => `Исполнитель: ${row.assignee?.fullName ?? '—'}`,
    search: (term) => ({ title: containsInsensitive(term) }),
    ownerWhere: (userId) => ({
      OR: [{ assigneeId: userId }, { creatorId: userId }],
    }),
  },

  cleaner: {
    model: 'Cleaner',
    entity: 'CLEANER',
    label: 'Клинер',
    financial: false,
    include: { brigade: { select: { name: true } } },
    title: (row) => row.fullName,
    subtitle: (row) =>
      `Ставка ${row.rate} сомони${row.brigade ? ` · ${row.brigade.name}` : ''}`,
    search: (term) => ({
      OR: [
        { fullName: containsInsensitive(term) },
        { phone: { contains: term } },
      ],
    }),
    ownerWhere: (userId) => ({ managerId: userId }),
    purgeGuard: async (prisma, id) => {
      const [shifts, fines, members] = await Promise.all([
        prisma.shift.count({ where: { cleanerId: id } }),
        prisma.fine.count({ where: { cleanerId: id } }),
        prisma.shiftGroupMember.count({ where: { cleanerId: id } }),
      ]);
      if (shifts > 0 || fines > 0 || members > 0) {
        throw new BadRequestException(
          'У клинера есть история смен, штрафов или выездов — удалить нельзя',
        );
      }
    },
  },

  user: {
    model: 'User',
    entity: 'USER',
    label: 'Сотрудник',
    financial: false,
    title: (row) => row.fullName,
    subtitle: (row) =>
      `${row.login} · ${row.role === 'DIRECTOR' ? 'Директор' : 'Менеджер'}`,
    search: (term) => ({
      OR: [
        { fullName: containsInsensitive(term) },
        { login: containsInsensitive(term) },
      ],
    }),
    // Сотрудники — общая сущность компании: у обычного менеджера нет «своих»
    // сотрудников, увидеть их в корзине он может только если сам их удалил
    // (что на практике недоступно — удаляет только тот, у кого users:manage).
    ownerWhere: null,
    purgeGuard: async (prisma, id) => {
      // Report.manager — Restrict: физическое удаление упадёт P2003, если есть
      // хоть одна ведомость (в т.ч. уже принятая — по ней выплачены деньги).
      const reports = await prisma.report.count({ where: { managerId: id } });
      if (reports > 0) {
        throw new BadRequestException(
          'У сотрудника есть платёжные ведомости — удалить нельзя',
        );
      }
      // Task.assignee/creator — Cascade: purge молча стёр бы чужие задачи,
      // если их не успели перебросить на другого сотрудника при увольнении.
      const tasks = await prisma.task.count({
        where: { OR: [{ assigneeId: id }, { creatorId: id }] },
      });
      if (tasks > 0) {
        throw new BadRequestException(
          'У сотрудника остались задачи — сначала переназначьте их',
        );
      }
    },
  },

  report: {
    model: 'Report',
    entity: 'REPORT',
    label: 'Ведомость',
    financial: true,
    title: (row) => `Ведомость — ${row.clientName}`,
    subtitle: (row) => `${row.address ?? ''} · ${row.totalPrice} сомони`.trim(),
    search: (term) => ({
      OR: [
        { clientName: containsInsensitive(term) },
        { address: containsInsensitive(term) },
      ],
    }),
    ownerWhere: (userId) => ({ managerId: userId }),
  },

  financeEntry: {
    model: 'FinanceEntry',
    entity: 'FINANCE',
    label: 'Финансовая запись',
    financial: true,
    title: (row) => row.title,
    subtitle: (row) =>
      `${row.kind === 'INCOME' ? 'Доход' : 'Расход'} · ${row.amount} сомони · ${formatDate(row.date)}`,
    search: (term) => ({ title: containsInsensitive(term) }),
    ownerWhere: (userId) => ({ createdById: userId }),
  },

  bonus: {
    model: 'Bonus',
    entity: 'BONUS',
    label: 'Премия',
    financial: true,
    title: (row) => `Премия — ${row.recipientName}`,
    subtitle: (row) => `${row.amount} сомони · ${row.reason}`,
    search: (term) => ({
      OR: [
        { recipientName: containsInsensitive(term) },
        { reason: containsInsensitive(term) },
      ],
    }),
    ownerWhere: (userId) => ({ createdById: userId }),
  },

  tariff: {
    model: 'Tariff',
    entity: 'SERVICE',
    label: 'Услуга',
    financial: false,
    title: (row) => row.title,
    subtitle: (row) => `Ключ: ${row.key}`,
    search: (term) => ({
      OR: [{ title: containsInsensitive(term) }, { key: containsInsensitive(term) }],
    }),
    ownerWhere: null,
    purgeGuard: async (prisma, id) => {
      const tariff = await prisma.tariff.findUnique({
        where: { id },
        select: { isSystem: true },
      });
      if (tariff?.isSystem) {
        throw new BadRequestException('Базовую услугу нельзя удалить безвозвратно');
      }
    },
  },

  extraService: {
    model: 'ExtraService',
    entity: 'SERVICE',
    label: 'Доп. услуга',
    financial: false,
    title: (row) => row.title,
    subtitle: (row) => `${row.price} сомони`,
    search: (term) => ({
      OR: [{ title: containsInsensitive(term) }, { key: containsInsensitive(term) }],
    }),
    ownerWhere: null,
    purgeGuard: async (prisma, id) => {
      const extra = await prisma.extraService.findUnique({
        where: { id },
        select: { isSystem: true },
      });
      if (extra?.isSystem) {
        throw new BadRequestException('Базовую услугу нельзя удалить безвозвратно');
      }
    },
  },

  proposal: {
    model: 'Proposal',
    entity: 'PROPOSAL',
    label: 'КП',
    financial: false,
    title: (row) => `КП №${row.number} — ${row.clientName}`,
    subtitle: (row) => `${row.total} сомони · ${row.status}`,
    search: (term) => ({
      OR: [
        { clientName: containsInsensitive(term) },
        { address: containsInsensitive(term) },
      ],
    }),
    ownerWhere: (userId) => ({ createdById: userId }),
  },

  reminder: {
    model: 'Reminder',
    entity: 'REMINDER',
    label: 'Напоминание',
    financial: false,
    title: (row) => row.title,
    subtitle: (row) => `${formatDateTime(row.remindAt)} · ${row.assigneeName}`,
    search: (term) => ({ title: containsInsensitive(term) }),
    ownerWhere: (userId) => ({
      OR: [{ assigneeId: userId }, { createdById: userId }],
    }),
  },

  shiftGroup: {
    model: 'ShiftGroup',
    entity: 'SHIFT_GROUP',
    label: 'Выезд',
    financial: false,
    title: (row) => `Выезд — ${row.address}`,
    subtitle: (row) =>
      `${formatDate(row.date)}${row.brigadeName ? ` · ${row.brigadeName}` : ''}`,
    search: (term) => ({ address: containsInsensitive(term) }),
    ownerWhere: (userId) => ({ managerId: userId }),
  },
};

export function assertTrashType(type: string): TrashType {
  if (!TRASH_TYPES.includes(type as TrashType)) {
    throw new BadRequestException(`Неизвестный тип корзины: ${type}`);
  }
  return type as TrashType;
}
