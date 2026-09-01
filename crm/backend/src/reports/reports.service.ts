import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, NotificationType, Prisma, ReportStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { seesFinance } from '../common/permissions';
import {
  OrderForReport,
  orderForReportInclude,
  reportDataFromOrder,
  workersFromOrder,
} from './report-from-order';

/** Целое неотрицательное число (сомони/дни) из произвольного ввода, с потолком (ниже int32) */
const int = (v: unknown, def = 0) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.min(n, 2_000_000_000);
};

/** Строка из произвольного ввода (защита от не-строк в теле запроса) */
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** id-строка или null */
const idOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Максимум смен по одной строке ведомости (защита от опечаток/вставок) */
const MAX_DAYS = 60;

/** «YYYY-MM-DD» → полночь UTC; null при пустом/неверном значении */
function dayUTC(s?: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

/** Сегодня в часовом поясе Душанбе как «YYYY-MM-DD» */
function todayDushanbe(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(
    new Date(),
  );
}

export interface WorkerInput {
  cleanerId?: string | null;
  fullName: string;
  role?: string;
  days?: number;
  rate: number;
  fine?: number;
  extra?: number;
}

export interface ExpenseInput {
  title: string;
  initiator?: string;
  amount: number;
  comment?: string;
}

export interface ReportInput {
  orderId?: string | null;
  clientName: string;
  clientPhone?: string;
  address?: string;
  workDate?: string | null;
  workEndDate?: string | null;
  unitsLabel?: string;
  extraServices?: string;
  discount?: number;
  totalPrice?: number;
  arrivedBy?: string;
  brigadierName?: string;
  managerName?: string;
  workers?: WorkerInput[];
  expenses?: ExpenseInput[];
}

const reportInclude = {
  manager: { select: { id: true, fullName: true } },
  workers: { orderBy: { rate: 'desc' as const } },
  expenses: true,
  order: {
    select: {
      id: true,
      cleaningType: true,
      area: true,
      seats: true,
      /*
       * Даты уборки нужны самой ведомости: по ним видно, сколько смен
       * причитается штатному клинеру. Без них редактор не мог заметить,
       * что в заказе три дня, а в строках работников проставлен один —
       * и заниженная сумма уходила основателю молча.
       */
      scheduledDate: true,
      scheduledEndDate: true,
      /*
       * Состав по дням многодневной уборки: без него ведомость ставила
       * каждому все дни заказа («Вали»: в карточке 14 710, в отчёте
       * 18 820) — раскладка «кто выходил в какой день» игнорировалась.
       */
      dayTeams: true,
      /*
       * Команда заказа — чтобы ведомость видела, кого в ней не хватает.
       *
       * Состав снимается один раз, при создании ведомости. Людей, которых
       * вписали в заказ позже, она не замечала: в карточке «Итого клинерам
       * 9 390», а в ведомости 7 890 — двух разовых там просто не было.
       */
      cleaners: {
        select: {
          id: true,
          fullName: true,
          rate: true,
          leaderOf: { select: { id: true } },
        },
      },
      guestCleaners: true,
    },
  },
};

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private audit: AuditService,
  ) {}

  /**
   * Чьи ведомости человек видит.
   *
   * Руководителю — все, КРОМЕ чужих черновиков (решение владельца): черновик
   * это работа менеджера в процессе, и в списке руководителя он только
   * мешает. Свои черновики руководитель видит — их составил он сам.
   * Менеджер, как и прежде, видит только свои.
   */
  private scope(user: AuthUser): Prisma.ReportWhereInput {
    if (!seesFinance(user)) return { ...NOT_DELETED, managerId: user.id };
    return {
      ...NOT_DELETED,
      OR: [
        { status: { not: ReportStatus.DRAFT } },
        { managerId: user.id },
      ],
    };
  }

  list(user: AuthUser) {
    return this.prisma.report.findMany({
      where: this.scope(user),
      include: reportInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOne(user: AuthUser, id: string) {
    // findFirst, а не findUnique: вместе с идентификатором нужен фильтр корзины
    const report = await this.prisma.report.findFirst({
      where: { id, ...NOT_DELETED },
      include: reportInclude,
    });
    if (!report) throw new NotFoundException('Отчёт не найден');
    if (!seesFinance(user) && report.managerId !== user.id) {
      throw new NotFoundException('Отчёт не найден');
    }
    return report;
  }

  private sanitizeWorkers(input?: WorkerInput[]) {
    const rows = (Array.isArray(input) ? input : [])
      .filter((w) => str(w?.fullName))
      .map((w) => ({
        cleanerId: idOrNull(w.cleanerId),
        fullName: str(w.fullName),
        role: str(w.role) || 'Клинер',
        // явный 0 дней допустим (работник в ведомости только со штрафом)
        days: Math.min(MAX_DAYS, int(w.days, 1)),
        rate: int(w.rate),
        fine: int(w.fine),
        extra: int(w.extra),
      }));

    /*
     * Ведомость — документ, по которому людям платят. Строка с отработанными
     * днями и нулевой ставкой означает «работал бесплатно»: при приёмке такая
     * строка создаёт смену без денег, и человек недосчитается зарплаты.
     *
     * Ноль приходил не от злого умысла: интерфейс подставлял в поле ставки
     * значение, которого не получил с сервера, и Number('undefined') || 0
     * молча давал ноль. Проверка здесь — последний рубеж: пропускаем только
     * строки без отработанных дней (работник внесён ради одного штрафа).
     */
    const unpaid = rows.filter((w) => w.days > 0 && w.rate <= 0);
    if (unpaid.length > 0) {
      throw new BadRequestException(
        `Укажите ставку для работников: ${unpaid.map((w) => w.fullName).join(', ')}`,
      );
    }
    return rows;
  }

  private sanitizeExpenses(input?: ExpenseInput[]) {
    return (Array.isArray(input) ? input : [])
      .filter((e) => str(e?.title) && int(e?.amount) > 0)
      .map((e) => ({
        title: str(e.title),
        initiator: str(e.initiator) || null,
        amount: int(e.amount),
        comment: str(e.comment) || null,
      }));
  }

  private baseData(dto: ReportInput) {
    if (!str(dto.clientName)) {
      throw new BadRequestException('Укажите клиента / объект');
    }
    return {
      orderId: idOrNull(dto.orderId),
      clientName: str(dto.clientName),
      clientPhone: str(dto.clientPhone) || null,
      address: str(dto.address) || null,
      workDate: dayUTC(typeof dto.workDate === 'string' ? dto.workDate : null),
      workEndDate: dayUTC(
        typeof dto.workEndDate === 'string' ? dto.workEndDate : null,
      ),
      unitsLabel: str(dto.unitsLabel) || null,
      extraServices: str(dto.extraServices) || null,
      discount: int(dto.discount),
      totalPrice: int(dto.totalPrice),
      arrivedBy: str(dto.arrivedBy) || null,
      brigadierName: str(dto.brigadierName) || null,
    };
  }

  /** Ошибки внешних ключей (битый orderId/cleanerId) → понятный 400 */
  private mapPrismaError(e: unknown): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === 'P2003' || e.code === 'P2025')
    ) {
      throw new BadRequestException(
        'Заказ или клинер не найден — обновите страницу',
      );
    }
    throw e;
  }

  /**
   * Черновик ведомости по заказу, переведённому в «Оплачено» (ТЗ).
   *
   * Вызывается из orders.service внутри его транзакции. Менеджеру остаётся
   * проверить дни и нажать «Отправить основателю» — всё остальное уже заполнено
   * данными самого заказа: клиент, адрес, объём, сумма, ответственный менеджер
   * и назначенная команда.
   *
   * Повторный перевод заказа в «Оплачено» второй ведомости не создаёт.
   * Возвращает созданную ведомость или null, если она уже была.
   */
  async createFromOrder(
    db: PrismaService | Prisma.TransactionClient,
    orderId: string,
    fallbackOwnerId: string,
  ) {
    const existing = await db.report.findFirst({
      where: { orderId, ...NOT_DELETED },
      select: { id: true },
    });
    if (existing) return null;

    const order = (await db.order.findFirst({
      where: { id: orderId, ...NOT_DELETED },
      include: orderForReportInclude,
    })) as OrderForReport | null;
    if (!order) return null;

    // владелец ведомости обязателен — по нему работает доступ «вижу только своё».
    // Если у заказа менеджера нет, владельцем становится тот, кто закрыл заказ,
    // а видимое поле «Ответственный менеджер» остаётся пустым.
    const ownerId = order.managerId ?? fallbackOwnerId;

    return db.report.create({
      data: {
        ...reportDataFromOrder(order, ownerId),
        workers: { create: workersFromOrder(order) },
      },
      include: reportInclude,
    });
  }

  async create(user: AuthUser, dto: ReportInput) {
    try {
      return await this.prisma.report.create({
        data: {
          ...this.baseData(dto),
          managerId: user.id,
          managerName: str(dto.managerName) || user.fullName,
          workers: { create: this.sanitizeWorkers(dto.workers) },
          expenses: { create: this.sanitizeExpenses(dto.expenses) },
        },
        include: reportInclude,
      });
    } catch (e) {
      this.mapPrismaError(e);
    }
  }

  async update(user: AuthUser, id: string, dto: ReportInput) {
    const report = await this.getOne(user, id); // доступ + запасное имя менеджера
    if (report.status === ReportStatus.ACCEPTED) {
      throw new BadRequestException('Принятый отчёт нельзя изменить');
    }
    try {
      // статус проверяется условной записью ВНУТРИ транзакции —
      // параллельное «Принять» не может быть молча перезаписано
      return await this.prisma.$transaction(async (tx) => {
        const res = await tx.report.updateMany({
          where: { id, status: { not: ReportStatus.ACCEPTED } },
          data: {
            ...this.baseData(dto),
            managerName: str(dto.managerName) || report.managerName,
          },
        });
        if (res.count === 0) {
          throw new BadRequestException('Принятый отчёт нельзя изменить');
        }
        await tx.reportWorker.deleteMany({ where: { reportId: id } });
        await tx.reportExpense.deleteMany({ where: { reportId: id } });
        const workers = this.sanitizeWorkers(dto.workers).map((w) => ({
          ...w,
          reportId: id,
        }));
        if (workers.length) await tx.reportWorker.createMany({ data: workers });
        const expenses = this.sanitizeExpenses(dto.expenses).map((e) => ({
          ...e,
          reportId: id,
        }));
        if (expenses.length)
          await tx.reportExpense.createMany({ data: expenses });
        return tx.report.findUniqueOrThrow({
          where: { id },
          include: reportInclude,
        });
      });
    } catch (e) {
      this.mapPrismaError(e);
    }
  }

  /** Отправка основателю: черновик → отправлен + уведомление директорам */
  async send(user: AuthUser, id: string) {
    const report = await this.getOne(user, id);
    if (report.status !== ReportStatus.DRAFT) {
      throw new BadRequestException('Отчёт уже отправлен');
    }
    const updated = await this.prisma.report.update({
      where: { id },
      data: { status: ReportStatus.SENT, sentAt: new Date() },
      include: reportInclude,
    });
    await this.notifications.notifyDirectors({
      type: NotificationType.REPORT_SENT,
      title: 'Новая платёжная ведомость',
      message: `${updated.managerName ?? 'Менеджер'} · ${updated.clientName} · ${updated.totalPrice} сомони`,
    });
    return updated;
  }

  /**
   * Принятие основателем. Автоматически разносит данные в «Смены и выплаты»:
   * каждому работнику ведомости — смены (дни подряд от даты работ, снапшот
   * ставки из ведомости), штрафы из ведомости — в штрафы.
   * Уже существующие смены на те же даты не дублируются.
   */
  async accept(user: AuthUser, id: string) {
    if (!seesFinance(user)) {
      throw new ForbiddenException('Принимать отчёты может только основатель');
    }
    const report = await this.getOne(user, id);
    if (report.status === ReportStatus.ACCEPTED) {
      throw new BadRequestException('Отчёт уже принят');
    }

    const start =
      report.workDate ?? dayUTC(todayDushanbe()) ?? new Date();

    const shiftRows: {
      date: Date;
      cleanerId: string;
      rate: number;
      note: string;
    }[] = [];
    const fineRows: {
      cleanerId: string;
      amount: number;
      reason: string;
      date: Date;
      createdById: string;
    }[] = [];

    for (const w of report.workers) {
      if (!w.cleanerId) continue; // работник без привязки к клинеру — только в ведомости
      const days = Math.min(MAX_DAYS, w.days); // защита от битых старых строк
      for (let i = 0; i < days; i++) {
        shiftRows.push({
          date: new Date(start.getTime() + i * 24 * 3600 * 1000),
          cleanerId: w.cleanerId,
          // «доп. услуги» работника учитываем в выплате первого дня,
          // чтобы сумма в выплатах сошлась с ведомостью
          rate: w.rate + (i === 0 ? w.extra : 0),
          note: `Ведомость: ${report.clientName}`,
        });
      }
      if (w.fine > 0) {
        fineRows.push({
          cleanerId: w.cleanerId,
          amount: w.fine,
          reason: `По ведомости — ${report.clientName}`,
          date: start,
          createdById: user.id,
        });
      }
    }

    // атомарно: статус меняется условно (защита от двойного клика/гонки) —
    // смены и штрафы создаются только если именно этот запрос принял отчёт
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.report.updateMany({
        where: { id, status: { not: ReportStatus.ACCEPTED } },
        data: {
          status: ReportStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedById: user.id,
        },
      });
      if (res.count === 0) {
        throw new BadRequestException('Отчёт уже принят');
      }
      // Не перезаписываем уже существующие смены на эти даты (они могут
      // относиться к другому объекту/ручной отметке) — только добавляем
      // недостающие. Так принятие ведомости не искажает чужой учёт.
      await tx.shift.createMany({ data: shiftRows, skipDuplicates: true });
      if (fineRows.length > 0) {
        await tx.fine.createMany({ data: fineRows });
      }
      return tx.report.findUniqueOrThrow({
        where: { id },
        include: reportInclude,
      });
    });
  }

  /**
   * Удаление ведомости переносит её в корзину (ТЗ 6).
   *
   * Физического удаления здесь больше нет: ведомость — финансовый документ,
   * по принятым уже выплачены деньги. Восстановить её можно в разделе «Корзина».
   */
  async remove(user: AuthUser, id: string, reason?: string) {
    const report = await this.getOne(user, id);
    if (report.status === ReportStatus.ACCEPTED && !seesFinance(user)) {
      throw new BadRequestException('Принятый отчёт может удалить только основатель');
    }

    await this.prisma.report.update({
      where: { id },
      data: softDeleteData(user, reason),
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'REPORT',
      entityId: id,
      entityTitle: `Ведомость — ${report.clientName}`,
      action: AuditAction.DELETE,
      summary:
        report.status === ReportStatus.ACCEPTED
          ? 'Принятая ведомость перенесена в корзину'
          : 'Ведомость перенесена в корзину',
    });
    return { ok: true };
  }
}
