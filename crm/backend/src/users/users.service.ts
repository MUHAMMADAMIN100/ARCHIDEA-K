import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, FunnelStage, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { seesAllTasks } from '../common/permissions';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { momentRange } from '../common/time/dushanbe';
import { CreateUserDto } from './dto/create-user.dto';

/**
 * Незакрытые задачи сотрудника: учитываются и мульти-исполнители
 * (строки assignments), и старые задачи без них (по assigneeId).
 */
const openTasksOf = (id: string) => ({
  OR: [
    { assignments: { some: { userId: id, status: { not: 'DONE' as const } } } },
    {
      assignments: { none: {} },
      assigneeId: id,
      status: { not: 'DONE' as const },
    },
  ],
});

const SAFE_SELECT = {
  id: true,
  login: true,
  fullName: true,
  role: true,
  phone: true,
  position: true,
  duties: true,
  mainTask: true,
  canManageOps: true,
  /** ТЗ 1.2 — полный доступ к модулю задач */
  canManageTasks: true,
  canSeeTrash: true,
  noFinance: true,
  /** ТЗ 10 — личные уведомления в Telegram */
  telegramChatId: true,
  telegramEnabled: true,
  acceptsLeads: true,
  isActive: true,
  createdAt: true,
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({
      where: NOT_DELETED,
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  findManagers() {
    return this.prisma.user.findMany({
      where: { ...NOT_DELETED, role: Role.MANAGER },
      select: SAFE_SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  /**
   * Сотрудники, которым можно ставить задачи.
   *
   * Кто ведёт задачи компании (руководитель, операционный управляющий, Ирода) —
   * получает весь список. Остальные заводят задачи только себе, поэтому им
   * возвращается ровно одна строка — они сами. Отвечать 403 нельзя: форма
   * задачи в календаре открыта всем, и без списка она бы просто не работала.
   */
  /**
   * Все действующие сотрудники — для выбора ОТВЕТСТВЕННОГО за клиента и заказ.
   *
   * Отличается от assignable() тем, что открыт каждому и всегда возвращает
   * весь штат. Списки разные по смыслу: задачу рядовой сотрудник ставит
   * только себе, а вот передать заявку коллеге он должен уметь — иначе
   * приходится заводить клиента на себя и просить руководителя переназначить.
   *
   * Отдаём только имя, должность и роль: ни телефонов, ни логинов, ни прав.
   */
  staff() {
    return this.prisma.user.findMany({
      where: { ...NOT_DELETED, isActive: true },
      select: { id: true, fullName: true, position: true, role: true, isActive: true },
      orderBy: { fullName: 'asc' },
    });
  }

  assignable(user: AuthUser) {
    if (!seesAll(user) && !seesAllTasks(user)) {
      return this.prisma.user.findMany({
        where: { id: user.id },
        select: {
          id: true,
          fullName: true,
          position: true,
          role: true,
          isActive: true,
        },
      });
    }
    return this.prisma.user.findMany({
      where: { ...NOT_DELETED, isActive: true },
      // isActive отдаём осознанно: клиент фильтрует список по этому полю, а без
      // него значение приходило undefined и выпадающий список оставался пустым
      select: {
        id: true,
        fullName: true,
        position: true,
        role: true,
        isActive: true,
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async create(dto: CreateUserDto & { canManageOps?: boolean }) {
    const login = dto.login.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { login } });
    if (exists) throw new BadRequestException('Логин уже занят');

    const passwordHash = await AuthService.hashPassword(dto.password);
    return this.prisma.user.create({
      data: {
        login,
        passwordHash,
        fullName: dto.fullName,
        role: dto.role ?? Role.MANAGER,
        phone: dto.phone,
        canManageOps: dto.canManageOps ?? false,
      },
      select: SAFE_SELECT,
    });
  }

  /** Карточка сотрудника + статистика. Доступ: руководитель или сам сотрудник. */
  async getOne(requester: AuthUser, id: string) {
    if (!seesAll(requester) && requester.id !== id) {
      throw new ForbiddenException('Нет доступа к этому профилю');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: SAFE_SELECT,
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    const activeStages: FunnelStage[] = [
      FunnelStage.NEW,
      FunnelStage.PROCESSING,
      FunnelStage.INSPECTION,
      FunnelStage.OFFER,
      FunnelStage.CONFIRMED,
      FunnelStage.IN_PROGRESS,
      FunnelStage.DONE,
    ];
    const [clients, ordersActive, ordersPaid, cleaners, tasksOpen] =
      await Promise.all([
        this.prisma.client.count({ where: { managerId: id } }),
        this.prisma.order.count({
          where: { managerId: id, stage: { in: activeStages } },
        }),
        this.prisma.order.count({
          where: { managerId: id, stage: FunnelStage.PAID },
        }),
        this.prisma.cleaner.count({ where: { managerId: id } }),
        this.prisma.task.count({ where: openTasksOf(id) }),
      ]);

    return {
      ...user,
      stats: { clients, ordersActive, ordersPaid, cleaners, tasksOpen },
    };
  }

  /** Список элементов для боксов профиля (клиенты/заказы/клинеры/задачи). */
  async getList(
    requester: AuthUser,
    id: string,
    type: string,
  ): Promise<{ id: string; primary: string; secondary: string }[]> {
    if (!seesAll(requester) && requester.id !== id) {
      throw new ForbiddenException('Нет доступа');
    }
    const activeStages: FunnelStage[] = [
      FunnelStage.NEW,
      FunnelStage.PROCESSING,
      FunnelStage.INSPECTION,
      FunnelStage.OFFER,
      FunnelStage.CONFIRMED,
      FunnelStage.IN_PROGRESS,
      FunnelStage.DONE,
    ];

    if (type === 'clients') {
      const rows = await this.prisma.client.findMany({
        where: { managerId: id },
        orderBy: { lastContactAt: 'desc' },
      });
      return rows.map((c) => ({ id: c.id, primary: c.fullName, secondary: c.phone }));
    }
    if (type === 'active' || type === 'paid') {
      const rows = await this.prisma.order.findMany({
        where: {
          managerId: id,
          stage: type === 'paid' ? FunnelStage.PAID : { in: activeStages },
        },
        include: { client: { select: { fullName: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      return rows.map((o) => ({
        id: o.id,
        primary: o.client?.fullName ?? '—',
        secondary: `${o.area} м² · ${o.finalPrice ?? o.estimatedPrice} сомони`,
      }));
    }
    if (type === 'cleaners') {
      const rows = await this.prisma.cleaner.findMany({
        where: { managerId: id },
        orderBy: { fullName: 'asc' },
      });
      return rows.map((c) => ({
        id: c.id,
        primary: c.fullName,
        secondary: c.phone ?? '—',
      }));
    }
    if (type === 'tasks') {
      const rows = await this.prisma.task.findMany({
        where: openTasksOf(id),
        orderBy: { deadline: 'asc' },
      });
      return rows.map((t) => ({
        id: t.id,
        primary: t.title,
        secondary: t.deadline
          ? `до ${t.deadline.toLocaleDateString('ru-RU')}`
          : 'без срока',
      }));
    }
    return [];
  }

  /**
   * Показатели сотрудника за период — основа для расчёта зарплаты.
   *
   * Считаем по когорте обращений: заказы, СОЗДАННЫЕ в периоде и закреплённые
   * за сотрудником. «Оплачено» — сколько из них дошло до оплаты: так видна
   * личная конверсия, а не смешение чужих месяцев. Плюс выполненные задачи
   * и отработанные напоминания — для ролей, где продажи не главное.
   */
  async periodAnalytics(
    requester: AuthUser,
    id: string,
    from?: string,
    to?: string,
  ) {
    if (!seesAll(requester) && requester.id !== id) {
      throw new ForbiddenException('Нет доступа к этому профилю');
    }
    const range = momentRange(from, to);
    const hasRange = range.gte !== undefined || range.lte !== undefined;
    const orderScope = {
      ...NOT_DELETED,
      managerId: id,
      ...(hasRange ? { createdAt: range } : {}),
    };

    const [orders, tasksDone, remindersDone] = await Promise.all([
      this.prisma.order.findMany({
        where: orderScope,
        select: {
          id: true,
          stage: true,
          createdAt: true,
          cleaningType: true,
          area: true,
          seats: true,
          discount: true,
          estimatedPrice: true,
          finalPrice: true,
          client: { select: { id: true, fullName: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      // отметка выполнения фиксируется временем правки строки исполнителя
      this.prisma.taskAssignment.count({
        where: {
          userId: id,
          status: 'DONE',
          ...(hasRange ? { updatedAt: range } : {}),
          task: { deletedAt: null },
        },
      }),
      this.prisma.reminder.count({
        where: {
          assigneeId: id,
          status: 'DONE',
          deletedAt: null,
          ...(hasRange ? { doneAt: range } : {}),
        },
      }),
    ]);

    const price = (o: { finalPrice: number | null; estimatedPrice: number }) =>
      o.finalPrice ?? o.estimatedPrice ?? 0;
    const paid = orders.filter((o) => o.stage === FunnelStage.PAID);
    const rejected = orders.filter((o) => o.stage === FunnelStage.REJECTED);
    const revenue = paid.reduce((sum, o) => sum + price(o), 0);
    const discounts = paid.reduce((sum, o) => sum + (o.discount ?? 0), 0);

    return {
      total: orders.length,
      paid: paid.length,
      rejected: rejected.length,
      conversion: orders.length
        ? Math.round((paid.length / orders.length) * 100)
        : 0,
      revenue,
      average: paid.length ? Math.round(revenue / paid.length) : 0,
      discounts,
      tasksDone,
      remindersDone,
      orders: orders.map((o) => ({ ...o, price: price(o) })),
    };
  }

  /** Полное редактирование сотрудника руководителем. */
  async update(
    id: string,
    dto: {
      fullName?: string;
      login?: string;
      phone?: string;
      position?: string;
      duties?: string;
      mainTask?: string;
      role?: Role;
      canManageOps?: boolean;
      canManageTasks?: boolean;
      canSeeTrash?: boolean;
      noFinance?: boolean;
      acceptsLeads?: boolean;
      isActive?: boolean;
      password?: string;
      telegramChatId?: string | null;
      telegramEnabled?: boolean;
    },
    actor?: AuthUser,
  ) {
    const exists = await this.prisma.user.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!exists) throw new NotFoundException('Сотрудник не найден');

    const data: any = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.position !== undefined) data.position = dto.position || null;
    if (dto.duties !== undefined) data.duties = dto.duties || null;
    if (dto.mainTask !== undefined) data.mainTask = dto.mainTask || null;
    if (dto.canManageOps !== undefined) data.canManageOps = dto.canManageOps;
    if (dto.canSeeTrash !== undefined) {
      data.canSeeTrash = dto.canSeeTrash;
    }
    /*
     * Персональный запрет на финансы. Гасит и активные сессии: иначе
     * сотрудник с открытой вкладкой продолжал бы видеть деньги до
     * следующего входа, а флаг ставят именно чтобы закрыть доступ СЕЙЧАС.
     */
    if (dto.noFinance !== undefined && dto.noFinance !== exists.noFinance) {
      data.noFinance = dto.noFinance;
      data.sessionEpoch = { increment: 1 };
    }
    if (dto.canManageTasks !== undefined) {
      data.canManageTasks = dto.canManageTasks;
    }
    if (dto.acceptsLeads !== undefined) data.acceptsLeads = dto.acceptsLeads;
    if (dto.telegramChatId !== undefined) {
      data.telegramChatId = dto.telegramChatId?.trim() || null;
    }
    if (dto.telegramEnabled !== undefined) {
      data.telegramEnabled = dto.telegramEnabled;
    }
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.login) {
      const login = dto.login.trim().toLowerCase();
      const taken = await this.prisma.user.findUnique({ where: { login } });
      if (taken && taken.id !== id) {
        throw new BadRequestException('Логин уже занят');
      }
      data.login = login;
    }
    if (dto.password) {
      if (dto.password.length < 8) {
        throw new BadRequestException('Пароль должен быть не короче 8 символов');
      }
      data.passwordHash = await AuthService.hashPassword(dto.password);
      // смена пароля гасит все ранее выданные токены (в т.ч. украденные)
      data.sessionEpoch = { increment: 1 };
    }

    const after = await this.prisma.user.update({
      where: { id },
      data,
      select: SAFE_SELECT,
    });

    await this.audit.log(this.prisma, {
      user: actor ?? null,
      entity: 'USER',
      entityId: id,
      entityTitle: after.fullName,
      action: AuditAction.UPDATE,
      // значения паролей и служебных полей сессии маскируются самим журналом
      changes: this.audit.diff(exists as any, { ...exists, ...data } as any, [
        'fullName',
        'login',
        'phone',
        'position',
        'duties',
        'mainTask',
        'role',
        'canManageOps',
        'canManageTasks',
        'canSeeTrash',
        'noFinance',
        'acceptsLeads',
        'isActive',
        'passwordHash',
        'telegramEnabled',
      ]),
    });
    return after;
  }

  async setActive(id: string, isActive: boolean, actor?: AuthUser) {
    const user = await this.prisma.user.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const after = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: SAFE_SELECT,
    });
    await this.audit.log(this.prisma, {
      user: actor ?? null,
      entity: 'USER',
      entityId: id,
      entityTitle: user.fullName,
      action: AuditAction.UPDATE,
      summary: isActive ? 'Доступ включён' : 'Доступ отключён',
    });
    return after;
  }

  /** Удаление сотрудника (директор). Нельзя удалить свой аккаунт. */
  async remove(requester: AuthUser, id: string) {
    if (requester.id === id) {
      throw new BadRequestException('Нельзя удалить свой аккаунт');
    }
    const user = await this.prisma.user.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    // Задача каскадом привязана к основному исполнителю и к постановщику.
    // С мульти-исполнителями это опасно: удаление одного сотрудника снесло бы
    // общую задачу у ВСЕХ остальных. Поэтому сначала переводим такие задачи
    // на другого участника, а поставленные им задачи — на того, кто удаляет.
    const shared = await this.prisma.task.findMany({
      where: { assigneeId: id, assignments: { some: { userId: { not: id } } } },
      select: {
        id: true,
        assignments: {
          where: { userId: { not: id } },
          select: { userId: true },
          take: 1,
        },
      },
    });
    for (const t of shared) {
      await this.prisma.task.update({
        where: { id: t.id },
        data: { assigneeId: t.assignments[0].userId },
      });
    }
    await this.prisma.task.updateMany({
      where: { creatorId: id },
      data: { creatorId: requester.id },
    });

    /*
     * Сотрудник уходит в корзину, а не стирается: физическое удаление сносило
     * каскадом его платёжные ведомости, включая уже принятые — то есть
     * финансовый архив, по которому выплачены деньги.
     * Заодно снимаем доступ и гасим все его сессии.
     */
    await this.prisma.user.update({
      where: { id },
      data: {
        ...softDeleteData(requester),
        isActive: false,
        sessionEpoch: { increment: 1 },
      },
    });

    await this.audit.log(this.prisma, {
      user: requester,
      entity: 'USER',
      entityId: id,
      entityTitle: user.fullName,
      action: AuditAction.DELETE,
      summary: 'Сотрудник перенесён в корзину, доступ отключён',
    });
    return { ok: true };
  }

  /** История изменений по сотруднику (ТЗ 2) */
  history(id: string) {
    return this.audit.forEntity('USER', id);
  }

  /** Что этот сотрудник менял в системе (ТЗ 2) */
  activity(id: string) {
    return this.audit.byActor(id);
  }
}
