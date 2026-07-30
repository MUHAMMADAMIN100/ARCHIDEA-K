import { Role } from '@prisma/client';
import { AuthUser } from './decorators/current-user.decorator';

/**
 * Права доступа CRM.
 *
 * Ролей всего две (директор и менеджер), а оттенков доступа больше: ops-менеджер
 * видит всё кроме финансов, Ирода ведёт все задачи компании, корзину чистить
 * может только директор. Раскладывать это по ролям — значит плодить роли под
 * каждого сотрудника, поэтому доступ описан списком именованных прав, а роль и
 * флаги пользователя лишь определяют, какие права он получает.
 */
export type Permission =
  // Задачи
  | 'tasks:all' // видеть и вести ВСЕ задачи компании (ТЗ 1.2)
  // Услуги
  | 'services:manage' // создавать, править и удалять услуги (ТЗ 1.1)
  // Корзина
  | 'trash:view' // смотреть и восстанавливать (ТЗ 1.3)
  | 'trash:purge' // очищать безвозвратно (ТЗ 1.3)
  // Журнал изменений
  | 'audit:view' // история изменений (ТЗ 2)
  // Финансы
  | 'finance:view' // доходы, расходы, выплаты, премии (ТЗ 7)
  | 'finance:manage'
  // Сотрудники
  | 'users:manage'
  // Чек-листы и КП
  | 'checklists:manage' // править шаблоны чек-листов (ТЗ 8)
  | 'proposals:templates'; // править шаблоны КП (ТЗ 9.1)

/** Директор — полный доступ ко всему, кроме корзины (её выдают отдельно) */
const DIRECTOR: Permission[] = [
  'tasks:all',
  'services:manage',
  'audit:view',
  'finance:view',
  'finance:manage',
  'users:manage',
  'checklists:manage',
  'proposals:templates',
];

/**
 * Ops-менеджер (canManageOps) — как директор по операционной части,
 * но без денег: ни выплат, ни доходов и расходов, ни премий.
 */
const OPS: Permission[] = [
  'tasks:all',
  'audit:view',
  'checklists:manage',
  'proposals:templates',
];

/** Обычный менеджер */
const MANAGER: Permission[] = [];

export function permissionsOf(user: AuthUser | null | undefined): Permission[] {
  if (!user) return [];

  const base =
    user.role === Role.DIRECTOR ? DIRECTOR : user.canManageOps ? OPS : MANAGER;
  const list = new Set<Permission>(base);

  // Персональный доступ к модулю задач (ТЗ 1.2 — Ирода)
  if (user.canManageTasks) list.add('tasks:all');

  /*
   * Корзина — по персональному праву, а не по роли. Руководителей в компании
   * несколько, но разбирать удалённое доверено конкретным людям; чистить
   * безвозвратно вправе только руководитель, и только с этим правом.
   */
  if (user.canSeeTrash) {
    list.add('trash:view');
    if (user.role === Role.DIRECTOR) list.add('trash:purge');
  }

  return [...list];
}

export function can(
  user: AuthUser | null | undefined,
  permission: Permission,
): boolean {
  return permissionsOf(user).includes(permission);
}

/** Видит ли пользователь ВСЕ задачи компании, а не только свои (ТЗ 1.2) */
export function seesAllTasks(user: AuthUser | null | undefined): boolean {
  return can(user, 'tasks:all');
}

/** Доступ к финансовым разделам: директор — да, ops-менеджер — нет */
export function seesFinance(user: AuthUser | null | undefined): boolean {
  return can(user, 'finance:view');
}
