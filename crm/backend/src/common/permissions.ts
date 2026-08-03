import { Role } from '@prisma/client';
import { AuthUser } from './decorators/current-user.decorator';

/**
 * Права доступа CRM.
 *
 * Ролей всего две (директор и менеджер), а оттенков доступа больше, поэтому
 * доступ описан списком именованных прав, а роль и флаги пользователя лишь
 * определяют, какие права он получает.
 *
 * ВАЖНО про два разных понятия, которые легко перепутать:
 *
 *  - `seesAll(user)` (decorators/current-user) — ОБЛАСТЬ ДАННЫХ: чьи клиенты,
 *    заказы и задачи человек видит. У менеджера она остаётся своей.
 *  - `ops:manage` — ОПЕРАЦИОННЫЕ ПРАВА: команда, бригады, выезды, учёт смен.
 *    У этих сущностей нет владельца («мой клинер» не бывает), поэтому право
 *    на них не может выводиться из области данных.
 *
 * Раньше и то и другое решалось одним `seesAll`, из-за чего менеджер, которому
 * нужен раздел «Смены и выезды», автоматически получал бы и чужих клиентов.
 */
export type Permission =
  // Задачи
  | 'tasks:all' // видеть и вести ВСЕ задачи компании (ТЗ 1.2)
  // Операционное управление: команда, бригады, выезды, учёт смен (ТЗ 2, 4)
  | 'ops:manage'
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
  'ops:manage',
  'services:manage',
  'audit:view',
  'finance:view',
  'finance:manage',
  'users:manage',
  'checklists:manage',
  'proposals:templates',
];

/**
 * Менеджер — полный операционный доступ, БЕЗ денег и БЕЗ управления доступами.
 *
 * Решение владельца: менеджер работает как руководитель во всём, кроме финансов.
 * Поэтому ему открыты команда и выезды, справочник услуг, чек-листы, шаблоны КП
 * и журнал изменений.
 *
 * Закрыты намеренно и по разным причинам:
 *  - `finance:*` — доходы, расходы и премии компании (прямое требование);
 *  - `users:manage` — оттуда можно сменить себе роль на «Руководитель», то есть
 *    запрет на финансы обходится в два клика. Без этого пункта все остальные
 *    ограничения ничего не стоят;
 *  - `trash:*` — разбирать удалённое доверено только руководителю;
 *  - `tasks:all` — область данных у менеджера своя, задачи компании ведёт
 *    руководство (плюс сотрудники с личным флагом canManageTasks).
 */
const MANAGER: Permission[] = [
  'ops:manage',
  'services:manage',
  'audit:view',
  'checklists:manage',
  'proposals:templates',
];

export function permissionsOf(user: AuthUser | null | undefined): Permission[] {
  if (!user) return [];

  const list = new Set<Permission>(
    user.role === Role.DIRECTOR ? DIRECTOR : MANAGER,
  );

  /*
   * Расширенный доступ (canManageOps) теперь означает только одно — область
   * данных всей компании (см. seesAll). Разделы менеджеру и так открыты, но
   * вместе с общей базой логично отдать и задачи компании: раньше этот флаг
   * давал их, и снимать уже выданный доступ при доработке незачем.
   */
  if (user.canManageOps) list.add('tasks:all');

  // Персональный доступ к модулю задач (ТЗ 1.2 — Ирода)
  if (user.canManageTasks) list.add('tasks:all');

  /*
   * Корзина — только руководителю и только с личным правом. Руководителей в
   * компании несколько, но разбирать удалённое доверено конкретным людям.
   */
  if (user.canSeeTrash && user.role === Role.DIRECTOR) {
    list.add('trash:view');
    list.add('trash:purge');
  }

  /*
   * Персональный запрет на финансы — СИЛЬНЕЕ роли.
   *
   * Стоит последним и именно поэтому работает: что бы ни дала роль выше,
   * деньги здесь отбираются. Руководителей в компании несколько, но доходы
   * и расходы владелец открывает не каждому. Сотрудник сохраняет управление
   * людьми и операциями — теряет только деньги.
   */
  if (user.noFinance) {
    list.delete('finance:view');
    list.delete('finance:manage');
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

/** Доступ к финансовым разделам: только руководитель */
export function seesFinance(user: AuthUser | null | undefined): boolean {
  return can(user, 'finance:view');
}

/**
 * Персональный запрет на деньги компании.
 *
 * Отличается от seesFinance тем, что это ЗАПРЕТ, а не отсутствие права.
 * Менеджеру книга доходов не положена по роли, но платёжные ведомости он
 * ведёт — они его работа. А сотруднику с галочкой «без доступа к финансам»
 * закрыты и они: владелец закрывает деньги целиком, включая выплаты.
 */
export function financeBanned(user: AuthUser | null | undefined): boolean {
  return user?.noFinance === true;
}

/** Управление командой, бригадами, выездами и учётом смен (ТЗ 2, 4) */
export function managesOps(user: AuthUser | null | undefined): boolean {
  return can(user, 'ops:manage');
}
