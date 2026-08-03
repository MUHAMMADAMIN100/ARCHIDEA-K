import { Role } from '@prisma/client';
import { AuthUser } from './decorators/current-user.decorator';
import {
  Permission,
  can,
  financeBanned,
  managesOps,
  permissionsOf,
  seesAllTasks,
  seesFinance,
} from './permissions';

/**
 * Права доступа — то место, где ошибка стоит дороже всего: либо сотрудник
 * видит чужие деньги, либо не может работать. Здесь зафиксировано РЕШЕНИЕ
 * ВЛАДЕЛЬЦА: менеджер работает как руководитель во всём, кроме финансов,
 * управления сотрудниками, журнала безопасности и корзины.
 *
 * Если кто-то поменяет правила в permissions.ts, эти тесты обязаны упасть.
 */

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    login: 'test',
    fullName: 'Тестовый Сотрудник',
    role: Role.MANAGER,
    canManageOps: false,
    canManageTasks: false,
    canSeeTrash: false,
    noFinance: false,
    ...overrides,
  };
}

const director = (o: Partial<AuthUser> = {}) =>
  user({ role: Role.DIRECTOR, ...o });
const manager = (o: Partial<AuthUser> = {}) =>
  user({ role: Role.MANAGER, ...o });

describe('Права: роль «Менеджер»', () => {
  const OPEN: Permission[] = [
    'ops:manage',
    'services:manage',
    'audit:view',
    'checklists:manage',
    'proposals:templates',
  ];
  const CLOSED: Permission[] = [
    'finance:view',
    'finance:manage',
    'users:manage',
    'trash:view',
    'trash:purge',
    'tasks:all',
  ];

  it.each(OPEN)('открыто: %s', (permission) => {
    expect(can(manager(), permission)).toBe(true);
  });

  it.each(CLOSED)('закрыто: %s', (permission) => {
    expect(can(manager(), permission)).toBe(false);
  });

  it('никаких других прав, кроме перечисленных, не появляется', () => {
    expect([...permissionsOf(manager())].sort()).toEqual([...OPEN].sort());
  });
});

describe('Права: роль «Руководитель»', () => {
  const OPEN: Permission[] = [
    'ops:manage',
    'services:manage',
    'audit:view',
    'checklists:manage',
    'proposals:templates',
    'finance:view',
    'finance:manage',
    'users:manage',
    'tasks:all',
  ];

  it.each(OPEN)('открыто: %s', (permission) => {
    expect(can(director(), permission)).toBe(true);
  });

  it('корзина НЕ выдаётся автоматически — нужен личный флаг', () => {
    expect(can(director(), 'trash:view')).toBe(false);
    expect(can(director(), 'trash:purge')).toBe(false);
  });
});

describe('Корзина: только руководитель и только с личным правом', () => {
  it('руководитель с флагом — смотрит и очищает', () => {
    const u = director({ canSeeTrash: true });
    expect(can(u, 'trash:view')).toBe(true);
    expect(can(u, 'trash:purge')).toBe(true);
  });

  it('менеджер с флагом — доступа НЕТ (решение владельца)', () => {
    const u = manager({ canSeeTrash: true });
    expect(can(u, 'trash:view')).toBe(false);
    expect(can(u, 'trash:purge')).toBe(false);
  });

  it('руководитель без флага — доступа нет', () => {
    expect(can(director({ canSeeTrash: false }), 'trash:view')).toBe(false);
  });
});

describe('Задачи компании (tasks:all)', () => {
  it('обычному менеджеру не даются', () => {
    expect(seesAllTasks(manager())).toBe(false);
  });

  it('даются по флагу «видит базу всей компании»', () => {
    expect(seesAllTasks(manager({ canManageOps: true }))).toBe(true);
  });

  it('даются по личному флагу доступа к задачам (случай Ироды)', () => {
    expect(seesAllTasks(manager({ canManageTasks: true }))).toBe(true);
  });

  it('личный флаг задач НЕ открывает ни финансы, ни корзину, ни сотрудников', () => {
    const u = manager({ canManageTasks: true });
    expect(can(u, 'finance:view')).toBe(false);
    expect(can(u, 'trash:view')).toBe(false);
    expect(can(u, 'users:manage')).toBe(false);
  });
});

describe('Финансы закрыты от менеджера при любых флагах', () => {
  const flagCombos: Partial<AuthUser>[] = [
    {},
    { canManageOps: true },
    { canManageTasks: true },
    { canSeeTrash: true },
    { canManageOps: true, canManageTasks: true, canSeeTrash: true },
  ];

  it.each(flagCombos)('флаги %j — доступа к деньгам нет', (flags) => {
    const u = manager(flags);
    expect(seesFinance(u)).toBe(false);
    expect(can(u, 'finance:manage')).toBe(false);
  });

  it('у руководителя финансы открыты', () => {
    expect(seesFinance(director())).toBe(true);
  });
});

describe('Персональный запрет на финансы сильнее роли', () => {
  it('руководитель с галочкой теряет доступ к деньгам', () => {
    const u = director({ noFinance: true });
    expect(seesFinance(u)).toBe(false);
    expect(can(u, 'finance:view')).toBe(false);
    expect(can(u, 'finance:manage')).toBe(false);
  });

  it('но сохраняет всё остальное: людей, услуги, задачи, журнал', () => {
    const u = director({ noFinance: true });
    expect(can(u, 'users:manage')).toBe(true);
    expect(can(u, 'services:manage')).toBe(true);
    expect(can(u, 'tasks:all')).toBe(true);
    expect(can(u, 'audit:view')).toBe(true);
    expect(can(u, 'ops:manage')).toBe(true);
  });

  it('и корзину, если она была выдана', () => {
    const u = director({ noFinance: true, canSeeTrash: true });
    expect(can(u, 'trash:view')).toBe(true);
    expect(can(u, 'trash:purge')).toBe(true);
  });

  it('галочка у менеджера ничего не ломает — у него денег и так не было', () => {
    const u = manager({ noFinance: true });
    expect(can(u, 'finance:view')).toBe(false);
    expect(can(u, 'ops:manage')).toBe(true);
  });

  it('снятая галочка возвращает деньги руководителю', () => {
    expect(seesFinance(director({ noFinance: false }))).toBe(true);
  });
});

describe('Операционное управление (ops:manage)', () => {
  it('есть у обеих ролей — бригады и выезды ведут все', () => {
    expect(managesOps(manager())).toBe(true);
    expect(managesOps(director())).toBe(true);
  });

  it('у неавторизованного пользователя прав нет вовсе', () => {
    expect(permissionsOf(null)).toEqual([]);
    expect(permissionsOf(undefined)).toEqual([]);
    expect(managesOps(null)).toBe(false);
    expect(seesFinance(null)).toBe(false);
    expect(seesAllTasks(null)).toBe(false);
  });
});

/**
 * Личный запрет на деньги — не то же самое, что отсутствие права.
 *
 * Платёжные ведомости менеджер ведёт: это его работа, и права `finance:view`
 * для них не требуется. А сотруднику, которому владелец закрыл деньги,
 * закрыты и они — там цена заказа и выплаты работникам.
 */
describe('Личный запрет на деньги (financeBanned)', () => {
  it('стоит у руководителя с галочкой', () => {
    expect(financeBanned(director({ noFinance: true }))).toBe(true);
  });

  it('не стоит у обычного менеджера — ведомости остаются его работой', () => {
    expect(financeBanned(manager())).toBe(false);
    expect(seesFinance(manager())).toBe(false);
  });

  it('не стоит у руководителя без галочки', () => {
    expect(financeBanned(director())).toBe(false);
  });

  it('у неавторизованного пользователя запрета нет — но и доступа тоже', () => {
    expect(financeBanned(null)).toBe(false);
    expect(seesFinance(null)).toBe(false);
  });
});
