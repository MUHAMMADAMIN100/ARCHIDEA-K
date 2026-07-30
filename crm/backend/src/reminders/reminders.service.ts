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
  ReminderSource,
  ReminderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import {
  formatDushanbe,
  momentRange,
  parseDate,
  startOfDay,
} from '../common/time/dushanbe';
import { CreateReminderDto, ReminderQueryDto, UpdateReminderDto } from './dto/reminder.dto';

const clientSelect = { id: true, fullName: true, phone: true } as const;

type RescheduleInput = { remindAt?: string; intervalDays?: number };

@Injectable()
export class RemindersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Сообщить сотруднику, что напоминание поставили на него.
   *
   * Без этого назначение было односторонним: руководитель выбирал исполнителя,
   * а тот узнавал о поручении только когда сам заходил в «Напоминания».
   * Себе не пишем — человек и так знает, что только что создал.
   */
  private async notifyAssignee(params: {
    assigneeId: string;
    authorId: string;
    authorName: string;
    clientName: string;
    title: string;
    remindAt: Date;
    orderId?: string | null;
  }) {
    if (params.assigneeId === params.authorId) return;
    await this.notifications.notify({
      userId: params.assigneeId,
      type: NotificationType.REMINDER_ASSIGNED,
      title: 'Вам поставили напоминание',
      message: `${params.clientName} · ${params.title} · ${formatDushanbe(params.remindAt)} · от ${params.authorName}`,
      orderId: params.orderId ?? undefined,
    });
  }

  /** Менеджер видит и ведёт только свои напоминания; директор и ops-менеджер — все (ТЗ 10.1) */
  async list(user: AuthUser, q: ReminderQueryDto) {
    const where: Prisma.ReminderWhereInput = { ...NOT_DELETED };
    if (!seesAll(user)) {
      where.assigneeId = user.id;
    } else if (q.assigneeId) {
      where.assigneeId = q.assigneeId;
    }
    if (q.status) where.status = q.status;
    if (q.from || q.to) where.remindAt = momentRange(q.from, q.to);

    return this.prisma.reminder.findMany({
      where,
      include: { client: { select: clientSelect } },
      orderBy: { remindAt: 'asc' },
    });
  }

  /** Бейдж в меню: сколько просрочено / на сегодня / впереди / выполнено */
  async counts(user: AuthUser) {
    const scope: Prisma.ReminderWhereInput = { ...NOT_DELETED };
    if (!seesAll(user)) scope.assigneeId = user.id;

    const todayStart = startOfDay();
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const [overdue, today, upcoming, done] = await Promise.all([
      this.prisma.reminder.count({
        where: { ...scope, status: ReminderStatus.PENDING, remindAt: { lt: todayStart } },
      }),
      this.prisma.reminder.count({
        where: {
          ...scope,
          status: ReminderStatus.PENDING,
          remindAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      this.prisma.reminder.count({
        where: { ...scope, status: ReminderStatus.PENDING, remindAt: { gte: tomorrowStart } },
      }),
      this.prisma.reminder.count({ where: { ...scope, status: ReminderStatus.DONE } }),
    ]);

    return { overdue, today, upcoming, done };
  }

  /**
   * Постановка напоминания. Используется и напрямую (кнопка «Напомнить»),
   * и заказами при оформлении предзаказа (`source: PREORDER`) — второй
   * модуль внедряет этот сервис и вызывает create() со своим source.
   */
  async create(user: AuthUser, dto: CreateReminderDto, source: ReminderSource = ReminderSource.MANUAL) {
    /*
     * Менеджер ставит напоминания только по СВОИМ клиентам и заказам.
     * Иначе через этот эндпоинт можно было перебором узнать чужую клиентскую
     * базу: ответ отличал существующего клиента от несуществующего.
     * Текст ошибки одинаковый — «не найден», как и в остальных модулях.
     */
    const client = await this.prisma.client.findFirst({
      where: {
        id: dto.clientId,
        ...NOT_DELETED,
        ...(seesAll(user) ? {} : { managerId: user.id }),
      },
      select: { id: true, fullName: true },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: {
          id: dto.orderId,
          ...NOT_DELETED,
          clientId: client.id,
          ...(seesAll(user) ? {} : { managerId: user.id }),
        },
        select: { id: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
    }

    const remindAt = this.resolveRemindAt(dto);
    const assignee = await this.resolveAssignee(user, dto.assigneeId);

    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Укажите название напоминания');

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.reminder.create({
        data: {
          clientId: client.id,
          orderId: dto.orderId ?? null,
          title,
          note: dto.note?.trim() || null,
          remindAt,
          source,
          assigneeId: assignee.id,
          assigneeName: assignee.fullName,
          createdById: user.id,
          createdByName: user.fullName,
        },
      });
      await this.audit.log(tx, {
        user,
        entity: 'REMINDER',
        entityId: row.id,
        entityTitle: `Напоминание — ${client.fullName}: ${row.title}`,
        action: AuditAction.CREATE,
        summary: `Исполнитель: ${assignee.fullName}`,
      });
      return row;
    });

    // вне транзакции: не доставленное уведомление не должно откатывать само поручение
    await this.notifyAssignee({
      assigneeId: assignee.id,
      authorId: user.id,
      authorName: user.fullName,
      clientName: client.fullName,
      title: created.title,
      remindAt: created.remindAt,
      orderId: created.orderId,
    });

    return created;
  }

  /** Правка своих напоминаний. Смена даты/интервала откладывает и возвращает в очередь (снятое SENT → PENDING) */
  async update(user: AuthUser, id: string, dto: UpdateReminderDto) {
    const existing = await this.findScoped(user, id);
    if (existing.status === ReminderStatus.CANCELLED) {
      throw new BadRequestException('Отменённое напоминание нельзя редактировать');
    }

    const data: Prisma.ReminderUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Укажите название напоминания');
      data.title = title;
    }
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;

    // «Отложить» = смена remindAt: напоминание возвращается в очередь на отправку
    if (dto.remindAt !== undefined || dto.intervalDays !== undefined) {
      data.remindAt = this.resolveRemindAt(dto);
      data.status = ReminderStatus.PENDING;
      data.sentAt = null;
      data.doneAt = null;
    }

    if (dto.assigneeId !== undefined) {
      if (!seesAll(user)) {
        throw new ForbiddenException('Нет прав менять исполнителя напоминания');
      }
      const assignee = await this.resolveAssignee(user, dto.assigneeId);
      data.assigneeId = assignee.id;
      data.assigneeName = assignee.fullName;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.reminder.update({ where: { id }, data });
      await this.audit.log(tx, {
        user,
        entity: 'REMINDER',
        entityId: id,
        entityTitle: `Напоминание — ${existing.assigneeName}: ${row.title}`,
        action: AuditAction.UPDATE,
        changes: this.audit.diff(existing, row, [
          'title',
          'note',
          'remindAt',
          'assigneeId',
          'status',
        ]),
      });
      return row;
    });

    // поручение передали другому — новый исполнитель должен об этом узнать
    if (updated.assigneeId !== existing.assigneeId) {
      const client = await this.prisma.client.findUnique({
        where: { id: updated.clientId },
        select: { fullName: true },
      });
      await this.notifyAssignee({
        assigneeId: updated.assigneeId,
        authorId: user.id,
        authorName: user.fullName,
        clientName: client?.fullName ?? 'клиент',
        title: updated.title,
        remindAt: updated.remindAt,
        orderId: updated.orderId,
      });
    }

    return updated;
  }

  /** Отметка «выполнено» — менеджер позвонил клиенту */
  async done(user: AuthUser, id: string) {
    const existing = await this.findScoped(user, id);
    if (existing.status === ReminderStatus.DONE) return existing;
    if (existing.status === ReminderStatus.CANCELLED) {
      throw new BadRequestException('Отменённое напоминание нельзя отметить выполненным');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reminder.update({
        where: { id },
        data: { status: ReminderStatus.DONE, doneAt: new Date() },
      });
      await this.audit.log(tx, {
        user,
        entity: 'REMINDER',
        entityId: id,
        entityTitle: `Напоминание — ${existing.assigneeName}: ${existing.title}`,
        action: AuditAction.UPDATE,
        summary: 'Отмечено выполненным',
      });
      return updated;
    });
  }

  /** Отмена напоминания (не путать с удалением — остаётся в списке до фильтра) */
  async cancel(user: AuthUser, id: string) {
    const existing = await this.findScoped(user, id);
    if (existing.status === ReminderStatus.DONE || existing.status === ReminderStatus.CANCELLED) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reminder.update({
        where: { id },
        data: { status: ReminderStatus.CANCELLED },
      });
      await this.audit.log(tx, {
        user,
        entity: 'REMINDER',
        entityId: id,
        entityTitle: `Напоминание — ${existing.assigneeName}: ${existing.title}`,
        action: AuditAction.UPDATE,
        summary: 'Отменено',
      });
      return updated;
    });
  }

  /** В корзину (ТЗ 6) */
  async remove(user: AuthUser, id: string, reason?: string) {
    const existing = await this.findScoped(user, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.reminder.update({ where: { id }, data: softDeleteData(user, reason) });
      await this.audit.log(tx, {
        user,
        entity: 'REMINDER',
        entityId: id,
        entityTitle: `Напоминание — ${existing.assigneeName}: ${existing.title}`,
        action: AuditAction.DELETE,
        summary: reason ?? undefined,
      });
    });
    return { ok: true };
  }

  /** Напоминание своё (или руководство — любое), не в корзине */
  private async findScoped(user: AuthUser, id: string) {
    const where: Prisma.ReminderWhereInput = { id, ...NOT_DELETED };
    if (!seesAll(user)) where.assigneeId = user.id;
    const reminder = await this.prisma.reminder.findFirst({ where });
    if (!reminder) throw new NotFoundException('Напоминание не найдено');
    return reminder;
  }

  /** Ровно один способ задать время напоминания — точная дата ИЛИ интервал */
  private resolveRemindAt(dto: RescheduleInput): Date {
    if (dto.remindAt && dto.intervalDays) {
      throw new BadRequestException('Укажите либо дату, либо интервал — не оба сразу');
    }
    if (dto.remindAt) {
      const date = parseDate(dto.remindAt);
      if (!date) throw new BadRequestException('Неверная дата напоминания');
      return date;
    }
    if (dto.intervalDays) {
      return new Date(Date.now() + dto.intervalDays * 24 * 60 * 60 * 1000);
    }
    throw new BadRequestException('Укажите дату или интервал напоминания');
  }

  /**
   * Исполнитель напоминания: обычный менеджер ведёт только свои — назначить
   * может только себя; руководство может передать другому активному сотруднику.
   */
  private async resolveAssignee(user: AuthUser, assigneeId?: string) {
    if (!assigneeId || assigneeId === user.id) {
      return { id: user.id, fullName: user.fullName };
    }
    if (!seesAll(user)) {
      throw new ForbiddenException('Нет прав назначать напоминание другому сотруднику');
    }
    const assignee = await this.prisma.user.findFirst({
      where: { id: assigneeId, isActive: true, ...NOT_DELETED },
      select: { id: true, fullName: true },
    });
    if (!assignee) throw new BadRequestException('Исполнитель не найден');
    return assignee;
  }
}
