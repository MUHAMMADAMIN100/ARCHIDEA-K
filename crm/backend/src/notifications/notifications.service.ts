import { Injectable } from '@nestjs/common';
import { NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * О чём вообще уведомляем (решение владельца).
 *
 * Колокольчик был забит переходами заказа по этапам: одна уборка давала
 * шесть строк «Статус заказа изменён», и за ними терялись новые заявки и
 * напоминания — то, на что действительно надо реагировать. Оставлены
 * четыре повода: обращение клиента, напоминание, задача и платёжная
 * ведомость, по которой нужно принять решение.
 *
 * Фильтр стоит в одном месте, а не в тридцати вызовах: добавить или
 * убрать повод — правка одной строки, и невозможно забыть про какой-то
 * из путей создания.
 */
const ALLOWED: ReadonlySet<NotificationType> = new Set([
  NotificationType.NEW_LEAD,
  NotificationType.NEW_TASK,
  NotificationType.TASK_STATUS_CHANGED,
  NotificationType.REMINDER_DUE,
  NotificationType.REMINDER_ASSIGNED,
  NotificationType.REPORT_SENT,
  NotificationType.REPORT_DRAFT_READY,
]);

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /** Создать уведомление конкретному пользователю */
  async notify(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    orderId?: string;
    taskId?: string;
    clientId?: string;
  }) {
    if (!ALLOWED.has(params.type)) return null;
    return this.prisma.notification.create({ data: params });
  }

  /**
   * Уведомить всех действующих сотрудников.
   *
   * Нужно для новой заявки с сайта: раньше её видел только тот менеджер,
   * которому она досталась при распределении, и руководитель не знал о
   * поступившем обращении вовсе.
   */
  async notifyEveryone(params: {
    type: NotificationType;
    title: string;
    message: string;
    orderId?: string;
    clientId?: string;
  }) {
    if (!ALLOWED.has(params.type)) return;
    const staff = await this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (staff.length === 0) return;
    await this.prisma.notification.createMany({
      data: staff.map((u) => ({ userId: u.id, ...params })),
    });
  }

  /** Уведомить всех руководителей (например, о крупном заказе) */
  async notifyDirectors(params: {
    type: NotificationType;
    title: string;
    message: string;
    orderId?: string;
    clientId?: string;
  }) {
    if (!ALLOWED.has(params.type)) return;
    const directors = await this.prisma.user.findMany({
      where: { role: Role.DIRECTOR, isActive: true },
      select: { id: true },
    });
    await this.prisma.notification.createMany({
      data: directors.map((d) => ({ userId: d.id, ...params })),
    });
  }

  list(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  }
}
