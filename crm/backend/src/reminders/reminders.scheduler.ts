import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationType, Prisma, ReminderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { escapeHtml } from '../telegram/telegram.util';
import { formatDateTime } from '../common/time/dushanbe';

/** Не более стольки напоминаний за проход — раз в 5 минут этого с запасом хватает на 7 сотрудников */
const BATCH_SIZE = 100;

const dueReminderInclude = {
  client: { select: { fullName: true, phone: true } },
} satisfies Prisma.ReminderInclude;

type DueReminder = Prisma.ReminderGetPayload<{ include: typeof dueReminderInclude }>;

/**
 * Раз в 5 минут превращает наступившие напоминания в уведомление CRM и
 * сообщение в Telegram (ТЗ 10.1).
 *
 * Пометка SENT делается в ТОЙ ЖЕ транзакции, что и создание CRM-уведомления
 * и постановка Telegram-сообщений в очередь: иначе при сбое между шагами
 * напоминание снова попадёт в выборку следующего прохода и уйдёт повторно.
 * Notification создаётся напрямую через tx (а не NotificationsService.notify(),
 * которая не принимает транзакцию) — ровно ради этой атомарности.
 */
@Injectable()
export class RemindersScheduler {
  private readonly logger = new Logger('RemindersScheduler');

  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
  ) {}

  @Cron('*/5 * * * *')
  async run(): Promise<void> {
    const due = await this.prisma.reminder.findMany({
      where: { status: ReminderStatus.PENDING, remindAt: { lte: new Date() }, deletedAt: null },
      include: dueReminderInclude,
      orderBy: { remindAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const reminder of due) {
      try {
        await this.fire(reminder);
      } catch (e) {
        this.logger.error(`Не удалось обработать напоминание ${reminder.id}`, e as Error);
      }
    }
  }

  private async fire(reminder: DueReminder): Promise<void> {
    const clientName = escapeHtml(reminder.client.fullName);
    const phoneLine = reminder.client.phone ? ` — ${escapeHtml(reminder.client.phone)}` : '';
    const text =
      `<b>Напоминание перезвонить</b>\n` +
      `${clientName}${phoneLine}\n` +
      `${escapeHtml(reminder.title)}\n` +
      `Срок: ${formatDateTime(reminder.remindAt)}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.reminder.update({
        where: { id: reminder.id },
        data: { status: ReminderStatus.SENT, sentAt: new Date() },
      });

      await tx.notification.create({
        data: {
          userId: reminder.assigneeId,
          type: NotificationType.REMINDER_DUE,
          title: 'Напоминание перезвонить',
          message: `${reminder.client.fullName}: ${reminder.title}`,
          orderId: reminder.orderId ?? undefined,
        },
      });

      await this.telegram.enqueueToUser(
        reminder.assigneeId,
        text,
        { kind: 'reminder', refId: reminder.id },
        tx,
      );
      await this.telegram.enqueueToCompanyChat(
        text,
        { kind: 'reminder', refId: reminder.id },
        tx,
      );
    });
  }
}
