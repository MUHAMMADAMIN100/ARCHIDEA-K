import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FunnelStage, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
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
  isActive: true,
  createdAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  findManagers() {
    return this.prisma.user.findMany({
      where: { role: Role.MANAGER },
      select: SAFE_SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  /** Сотрудники, которым можно ставить задачи. Доступ: директор или ops-менеджер. */
  assignable(user: AuthUser) {
    if (!seesAll(user)) {
      throw new ForbiddenException('Нет доступа');
    }
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, position: true, role: true },
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
      acceptsLeads?: boolean;
      isActive?: boolean;
      password?: string;
    },
  ) {
    const exists = await this.prisma.user.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Сотрудник не найден');

    const data: any = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.position !== undefined) data.position = dto.position || null;
    if (dto.duties !== undefined) data.duties = dto.duties || null;
    if (dto.mainTask !== undefined) data.mainTask = dto.mainTask || null;
    if (dto.canManageOps !== undefined) data.canManageOps = dto.canManageOps;
    if (dto.acceptsLeads !== undefined) data.acceptsLeads = dto.acceptsLeads;
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
    if (dto.password && dto.password.length >= 4) {
      data.passwordHash = await AuthService.hashPassword(dto.password);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: SAFE_SELECT,
    });
  }

  async setActive(id: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: SAFE_SELECT,
    });
  }

  /** Удаление сотрудника (директор). Нельзя удалить свой аккаунт. */
  async remove(requester: AuthUser, id: string) {
    if (requester.id === id) {
      throw new BadRequestException('Нельзя удалить свой аккаунт');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
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

    // клиенты/заказы/клинеры отвяжутся (managerId → null)
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
