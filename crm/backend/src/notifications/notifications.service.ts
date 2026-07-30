import { Injectable } from '@nestjs/common';
import { NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
