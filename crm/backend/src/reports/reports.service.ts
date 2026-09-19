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
  brigadierFromOrder,
  orderForReportInclude,
  planWorkerSync,
  reportDataFromOrder,
  workersFromOrder,
} from './report-from-order';
import { dayKey } from '../common/time/dushanbe';

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
      /*
       * Поле не прислали — связь с заказом НЕ трогаем (undefined для Prisma
       * значит «оставить как есть»). Раньше правка любого поля без orderId
       * молча отвязывала ведомость от заказа, и она переставала следовать за
       * карточкой, а приём снова начислял смены на день приёма.
       */
      orderId: dto.orderId === undefined ? undefined : idOrNull(dto.orderId),
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

  /**
   * Ведомость следует за карточкой заказа (решение владельца, сентябрь 2026:
   * цифры везде одинаковые).
   *
   * Раньше ведомость была снимком на момент «Оплачено» и дальше жила своей
   * жизнью: в карточку «Фархунды» дописали Гулнамо, выезд и аналитика стали
   * 1 480, а принятая ведомость так и осталась с пятью работниками на 1 250.
   *
   * Что сводится с заказом: состав работников (штатные по идентификатору,
   * разовые по имени), дни у штатных (по датам уборки), сумма разовых (из
   * карточки), даты работ, адрес, бригадир. Что НЕ трогается: ставки и роли
   * уже записанных штатных (снапшот), штрафы и доп. услуги в строках,
   * расходы — это ручная работа управляющего, её карточка не знает.
   *
   * Принятую ведомость тоже правим — иначе документ у основателя врал бы про
   * начисленное. Но такая правка называется своим именем в журнале и уходит
   * уведомлением руководству: смены добавленному уже начислил выезд, а
   * бумага должна это отражать.
   */
  async syncFromOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    user: AuthUser,
  ): Promise<boolean> {
    /*
     * ВСЕ ведомости заказа, а не первая попавшаяся. По заказу «Фархунда» их
     * оказалось две — невидимый чужой черновик и принятая; сверка первой
     * (черновика) оставила принятую с прежними строками, и цифры снова
     * разошлись. Все документы по одному объекту описывают одну работу и
     * обязаны совпадать.
     */
    const reports = await tx.report.findMany({
      where: { orderId, ...NOT_DELETED },
      include: { workers: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!reports.length) return false;
    const order = (await tx.order.findFirst({
      where: { id: orderId, ...NOT_DELETED },
      include: orderForReportInclude,
    })) as OrderForReport | null;
    if (!order) return false;

    let changedAny = false;
    for (const report of reports) {
      if (await this.syncOneReport(tx, report, order, user)) changedAny = true;
    }
    return changedAny;
  }

  private async syncOneReport(
    tx: Prisma.TransactionClient,
    report: Prisma.ReportGetPayload<{ include: { workers: true } }>,
    order: OrderForReport,
    user: AuthUser,
  ): Promise<boolean> {
    const orderId = order.id;
    const wanted = workersFromOrder(order);
    const diff = planWorkerSync(report.workers, wanted);
    const rowUpdates = diff.updates;

    const head: Prisma.ReportUncheckedUpdateInput = {};
    const headNotes: string[] = [];
    const workDate = order.scheduledDate ? dayUTC(dayKey(order.scheduledDate)) : null;
    const workEndDate =
      order.scheduledEndDate && order.scheduledDate ? dayUTC(dayKey(order.scheduledEndDate)) : null;
    if (workDate && report.workDate?.getTime() !== workDate.getTime()) {
      head.workDate = workDate;
      headNotes.push('дата работ');
    }
    if ((report.workEndDate?.getTime() ?? null) !== (workEndDate?.getTime() ?? null) && order.scheduledDate) {
      head.workEndDate = workEndDate;
      headNotes.push('дата завершения');
    }
    const brigadier = brigadierFromOrder(order);
    if (brigadier && brigadier !== report.brigadierName) {
      head.brigadierName = brigadier;
      headNotes.push('бригадир');
    }
    if (order.address && order.address !== report.address) {
      head.address = order.address;
      headNotes.push('адрес');
    }

    if (!diff.toAdd.length && !diff.toRemove.length && !rowUpdates.length && !headNotes.length) {
      return false;
    }

    if (diff.toRemove.length) {
      await tx.reportWorker.deleteMany({ where: { id: { in: diff.toRemove.map((w) => w.id) } } });
    }
    if (diff.toAdd.length) {
      await tx.reportWorker.createMany({
        data: diff.toAdd.map((w) => ({ ...w, reportId: report.id })),
      });
    }
    for (const u of rowUpdates) {
      await tx.reportWorker.update({ where: { id: u.id }, data: u.data });
    }
    if (headNotes.length) {
      await tx.report.update({ where: { id: report.id }, data: head });
    }

    const money = (w: { fullName: string; rate: number; days?: number }) =>
      `${w.fullName} (${w.rate}${(w.days ?? 1) > 1 ? ` × ${w.days} дн.` : ''})`;
    const bits: string[] = [];
    if (diff.toAdd.length) bits.push(`добавлены: ${diff.toAdd.map(money).join(', ')}`);
    if (diff.toRemove.length) bits.push(`убраны: ${diff.toRemove.map(money).join(', ')}`);
    if (rowUpdates.length) bits.push(`изменено: ${rowUpdates.map((u) => u.note).join(', ')}`);
    if (headNotes.length) bits.push(`обновлены: ${headNotes.join(', ')}`);
    const accepted = report.status === ReportStatus.ACCEPTED;
    const summary = `${
      accepted
        ? 'Ведомость ПРИНЯТА — приведена к карточке заказа после принятия'
        : 'Ведомость приведена к карточке заказа'
    }: ${bits.join('; ')}`;
    await this.audit.log(tx, {
      user,
      entity: 'REPORT',
      entityId: report.id,
      entityTitle: `Ведомость — ${report.clientName}`,
      action: AuditAction.UPDATE,
      summary,
    });
    if (accepted) {
      // основатель принял один документ, а теперь он другой — сказать об этом обязательно
      await this.notifications.notifyDirectors({
        type: NotificationType.REPORT_SENT,
        title: 'Принятая ведомость изменена по карточке заказа',
        message: `${report.clientName} — ${bits.join('; ')}`,
        orderId,
      });
    }
    return true;
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

    /*
     * День смен — день РАБОТ, а не день приёма.
     *
     * Раньше при пустой дате работ смены ставились на «сегодня». Ведомость
     * «Шер» приняли через восемь дней после уборки — и двенадцать человек
     * получили по второй смене на день приёма: смены выезда стояли 11.09,
     * смены ведомости 19.09, и защита от дублей (одна смена на человека в
     * день) их не увидела. Дата берётся из ведомости, иначе из заказа, и
     * только в самом крайнем случае — сегодня.
     */
    const start =
      report.workDate ??
      (report.order?.scheduledDate ? dayUTC(dayKey(report.order.scheduledDate)) : null) ??
      // ведомость без заказа и без даты: день, когда её составили, ближе к
      // работе, чем день, когда до неё дошли руки принять
      dayUTC(dayKey(report.createdAt)) ??
      dayUTC(todayDushanbe()) ??
      new Date();

    /*
     * Смены по заказу с закрытыми выездами уже начислены выездами
     * («Оплачено» = смены закрыты). Приём ведомости по такому заказу второй
     * раз тех же людей не начисляет — иначе один объект оплачивался дважды.
     * Ведомости без заказа и по старым заказам без выездов начисляют, как
     * и раньше: для них ведомость — единственный источник смен.
     */
    const accruedByVisits = new Set<string>(
      report.orderId
        ? (
            await this.prisma.shift.findMany({
              where: { group: { orderId: report.orderId, deletedAt: null } },
              select: { cleanerId: true },
            })
          ).map((s) => s.cleanerId)
        : [],
    );

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
      if (accruedByVisits.has(w.cleanerId)) {
        // смены этому человеку уже дал закрытый выезд заказа — штраф всё равно учитываем ниже
        if (w.fine > 0) {
          fineRows.push({
            cleanerId: w.cleanerId,
            amount: w.fine,
            reason: `По ведомости — ${report.clientName}`,
            date: start,
            createdById: user.id,
          });
        }
        continue;
      }
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
