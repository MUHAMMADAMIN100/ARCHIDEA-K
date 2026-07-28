import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  NotificationType,
  Prisma,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { seesAllTasks } from '../common/permissions';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';

/**
 * Полный доступ к модулю задач (ТЗ 1.2).
 *
 * Раньше «все задачи компании» видели только директор и ops-менеджер. Теперь
 * это отдельное право: его получают они же плюс сотрудники с флагом
 * canManageTasks — по ТЗ такой доступ нужен Ироде, которая остаётся менеджером.
 */
const seesAll = seesAllTasks;

const taskInclude = {
  assignee: { select: { id: true, fullName: true } },
  creator: { select: { id: true, fullName: true } },
  assignments: {
    select: {
      id: true,
      userId: true,
      status: true,
      user: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: 'Открыта',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнена',
};

const MAX_ASSIGNEES = 20;

/** Сводный статус задачи по статусам исполнителей */
function aggregate(statuses: TaskStatus[]): TaskStatus {
  if (statuses.length === 0) return TaskStatus.OPEN;
  if (statuses.every((s) => s === TaskStatus.DONE)) return TaskStatus.DONE;
  if (statuses.every((s) => s === TaskStatus.OPEN)) return TaskStatus.OPEN;
  return TaskStatus.IN_PROGRESS; // кто-то уже начал / часть закрыта
}

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private audit: AuditService,
  ) {}

  /**
   * Задачи, созданные до появления мульти-исполнителей, не имеют строк
   * assignments — подставляем «виртуального» исполнителя из assigneeId,
   * чтобы клиент всегда работал с одним форматом.
   */
  private shape(task: TaskWithRelations) {
    const assignments = task.assignments.length
      ? task.assignments
      : [
          {
            id: `legacy:${task.id}`,
            userId: task.assigneeId,
            status: task.status,
            user: task.assignee,
          },
        ];
    return { ...task, assignments };
  }

  /**
   * Директор и ops-менеджер видят все задачи; обычный менеджер — только те,
   * где он исполнитель (в т.ч. один из нескольких).
   */
  async list(user: AuthUser) {
    const where: Prisma.TaskWhereInput = seesAll(user)
      ? { ...NOT_DELETED }
      : {
          ...NOT_DELETED,
          OR: [
            { assigneeId: user.id },
            { assignments: { some: { userId: user.id } } },
          ],
        };
    const tasks = await this.prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ status: 'asc' }, { deadline: 'asc' }],
    });
    return tasks.map((t) => this.shape(t));
  }

  /** Постановка задачи (директор или ops-менеджер) + уведомления исполнителям */
  async create(
    user: AuthUser,
    dto: {
      title: string;
      description?: string;
      type?: TaskType;
      assigneeId?: string;
      assigneeIds?: string[];
      priority?: TaskPriority;
      deadline?: string;
    },
  ) {
    if (!seesAll(user)) {
      throw new ForbiddenException('Нет прав ставить задачи');
    }

    const title = (dto.title ?? '').trim();
    if (!title) throw new BadRequestException('Укажите название задачи');
    if (title.length > 200) {
      throw new BadRequestException('Слишком длинное название (макс. 200)');
    }
    const description = dto.description?.trim() || undefined;
    if (description && description.length > 2000) {
      throw new BadRequestException('Слишком длинное описание (макс. 2000)');
    }

    // список исполнителей: новый формат assigneeIds, старый assigneeId
    const ids = Array.from(
      new Set(
        (dto.assigneeIds?.length
          ? dto.assigneeIds
          : dto.assigneeId
            ? [dto.assigneeId]
            : []
        ).filter(Boolean),
      ),
    );
    if (ids.length === 0) {
      throw new BadRequestException('Выберите хотя бы одного исполнителя');
    }
    if (ids.length > MAX_ASSIGNEES) {
      throw new BadRequestException(
        `Слишком много исполнителей (макс. ${MAX_ASSIGNEES})`,
      );
    }
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    if (people.length !== ids.length) {
      throw new BadRequestException('Некоторые исполнители не найдены');
    }

    const deadline = this.parseDate(dto.deadline);

    const task = await this.prisma.task.create({
      data: {
        title,
        description,
        type: dto.type ?? TaskType.MEETING,
        assigneeId: ids[0], // основной — для совместимости
        creatorId: user.id,
        priority: dto.priority ?? TaskPriority.MEDIUM,
        deadline,
        assignments: { create: ids.map((userId) => ({ userId })) },
      },
      include: taskInclude,
    });

    await Promise.all(
      ids.map((userId) =>
        this.notifications.notify({
          userId,
          type: NotificationType.NEW_TASK,
          title: 'Новая задача от руководителя',
          message: `${task.title}${
            task.deadline
              ? ` · до ${task.deadline.toLocaleDateString('ru-RU')}`
              : ''
          }`,
          taskId: task.id,
        }),
      ),
    );

    return this.shape(task);
  }

  /**
   * Смена статуса. Исполнитель меняет ТОЛЬКО свой статус; директор/ops —
   * статус любого исполнителя (targetUserId). Постановщику уходит уведомление.
   */
  async updateStatus(
    user: AuthUser,
    id: string,
    status: TaskStatus,
    targetUserId?: string,
  ) {
    if (!Object.values(TaskStatus).includes(status)) {
      throw new BadRequestException('Неизвестный статус');
    }
    const task = await this.prisma.task.findFirst({
      where: { id, deletedAt: null },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    const isBoss = seesAll(user);
    const memberIds = task.assignments.length
      ? task.assignments.map((a) => a.userId)
      : [task.assigneeId];

    // чей статус меняем
    const userId = isBoss ? (targetUserId ?? memberIds[0]) : user.id;
    if (!memberIds.includes(userId)) {
      throw new ForbiddenException('Нет доступа к этой задаче');
    }

    // upsert — закрывает и старые задачи без строк assignments
    await this.prisma.taskAssignment.upsert({
      where: { taskId_userId: { taskId: id, userId } },
      create: { taskId: id, userId, status },
      update: { status },
    });

    // пересчитываем сводный статус задачи
    const rows = await this.prisma.taskAssignment.findMany({
      where: { taskId: id },
      select: { status: true },
    });
    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: aggregate(rows.map((r) => r.status)) },
      include: taskInclude,
    });

    // уведомляем постановщика (если он не сам менял статус)
    if (task.creatorId !== user.id) {
      const actor =
        updated.assignments.find((a) => a.userId === userId)?.user.fullName ??
        'Исполнитель';
      await this.notifications.notify({
        userId: task.creatorId,
        type: NotificationType.TASK_STATUS_CHANGED,
        title: 'Статус задачи изменён',
        message: `${actor}: «${task.title}» → ${STATUS_LABEL[status]}`,
        taskId: task.id,
      });
    }

    return this.shape(updated);
  }

  /** Перенос задачи на другой день (перетаскивание в календаре) */
  async updateDate(user: AuthUser, id: string, deadline: string | null) {
    if (!seesAll(user)) {
      throw new ForbiddenException('Нет прав переносить задачи');
    }
    const exists = await this.prisma.task.findFirst({ where: { id, deletedAt: null } });
    if (!exists) throw new NotFoundException('Задача не найдена');
    const task = await this.prisma.task.update({
      where: { id },
      data: { deadline: deadline ? this.parseDate(deadline) : null },
      include: taskInclude,
    });
    return this.shape(task);
  }

  /** Редактирование задачи (директор или ops-менеджер), в т.ч. смена состава */
  async update(
    user: AuthUser,
    id: string,
    dto: {
      title?: string;
      description?: string | null;
      type?: TaskType;
      priority?: TaskPriority;
      deadline?: string | null;
      assigneeIds?: string[];
    },
  ) {
    if (!seesAll(user)) {
      throw new ForbiddenException('Нет прав редактировать задачи');
    }
    const task = await this.prisma.task.findFirst({
      where: { id, deletedAt: null },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Укажите название задачи');
      if (title.length > 200) {
        throw new BadRequestException('Слишком длинное название (макс. 200)');
      }
      data.title = title;
    }
    if (dto.description !== undefined) {
      const d = dto.description?.trim() || null;
      if (d && d.length > 2000) {
        throw new BadRequestException('Слишком длинное описание (макс. 2000)');
      }
      data.description = d;
    }
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.deadline !== undefined) {
      data.deadline = dto.deadline ? this.parseDate(dto.deadline) : null;
    }

    // смена состава исполнителей: добавленным — уведомление, убранным — удаление
    let added: string[] = [];
    if (dto.assigneeIds !== undefined) {
      const ids = Array.from(new Set(dto.assigneeIds.filter(Boolean)));
      if (ids.length === 0) {
        throw new BadRequestException('Выберите хотя бы одного исполнителя');
      }
      if (ids.length > MAX_ASSIGNEES) {
        throw new BadRequestException(
          `Слишком много исполнителей (макс. ${MAX_ASSIGNEES})`,
        );
      }
      // уже назначенные сотрудники допустимы, даже если их отключили —
      // иначе задачу с уволенным исполнителем нельзя было бы отредактировать
      const alreadyOn = task.assignments.length
        ? task.assignments.map((a) => a.userId)
        : [task.assigneeId];
      const people = await this.prisma.user.findMany({
        where: {
          id: { in: ids },
          OR: [{ isActive: true }, { id: { in: alreadyOn } }],
        },
        select: { id: true },
      });
      if (people.length !== ids.length) {
        throw new BadRequestException('Некоторые исполнители не найдены');
      }
      // старая задача (до мульти-исполнителей): строк ещё нет,
      // её реальный статус хранится в Task.status — переносим его,
      // иначе выполненная задача молча вернулась бы в «Открыта»
      const isLegacy = task.assignments.length === 0;
      const current = isLegacy
        ? [task.assigneeId]
        : task.assignments.map((a) => a.userId);
      added = ids.filter((x) => !current.includes(x));
      const removed = current.filter((x) => !ids.includes(x));

      if (removed.length) {
        await this.prisma.taskAssignment.deleteMany({
          where: { taskId: id, userId: { in: removed } },
        });
      }
      for (const userId of ids) {
        await this.prisma.taskAssignment.upsert({
          where: { taskId_userId: { taskId: id, userId } },
          create: {
            taskId: id,
            userId,
            status:
              isLegacy && userId === task.assigneeId
                ? task.status
                : TaskStatus.OPEN,
          },
          update: {},
        });
      }
      data.assignee = { connect: { id: ids[0] } };
    }

    // сводный статус мог измениться из-за смены состава
    const rows = await this.prisma.taskAssignment.findMany({
      where: { taskId: id },
      select: { status: true },
    });
    if (rows.length) data.status = aggregate(rows.map((r) => r.status));

    const updated = await this.prisma.task.update({
      where: { id },
      data,
      include: taskInclude,
    });

    await Promise.all(
      added.map((userId) =>
        this.notifications.notify({
          userId,
          type: NotificationType.NEW_TASK,
          title: 'Новая задача от руководителя',
          message: `${updated.title}${
            updated.deadline
              ? ` · до ${updated.deadline.toLocaleDateString('ru-RU')}`
              : ''
          }`,
          taskId: updated.id,
        }),
      ),
    );

    return this.shape(updated);
  }

  /** Удаление задачи — перенос в корзину (ТЗ 6) */
  async remove(user: AuthUser, id: string, reason?: string) {
    if (!seesAll(user)) {
      throw new ForbiddenException('Нет прав удалять задачи');
    }
    const task = await this.prisma.task.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    const removed = await this.prisma.task.update({
      where: { id },
      data: softDeleteData(user, reason),
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'TASK',
      entityId: id,
      entityTitle: task.title,
      action: AuditAction.DELETE,
      summary: reason ? `Перенесена в корзину: ${reason}` : 'Перенесена в корзину',
    });
    return removed;
  }

  /** «YYYY-MM-DD» → полдень UTC (день не «уезжает» из-за часового пояса) */
  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00.000Z`)
      : new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }
    return d;
  }
}
