import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { FunnelStage, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { NOT_DELETED } from '../common/soft-delete';
import {
  dayKey,
  momentRange,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from '../common/time/dushanbe';

const TYPE_LABEL: Record<string, string> = {
  MAINTENANCE: 'Поддерживающая (архив)',
  GENERAL: 'Генеральная',
  POST_RENOVATION: 'После ремонта',
  FURNITURE: 'Мягкая мебель',
};
const SOURCE_LABEL: Record<string, string> = {
  SITE: 'Сайт',
  INSTAGRAM: 'Instagram',
  CALL: 'Звонок',
  RECOMMENDATION: 'Рекомендация',
};

export type AnalyticsPeriod =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'all';

/**
 * Сумма заказа для выручки.
 * finalPrice — итог после осмотра, estimatedPrice — предварительный расчёт.
 * Ноль здесь означает, что сумму так и не проставили: такие заказы считаем
 * отдельно и показываем в сверке, а не растворяем в выручке молча.
 */
function priceOf(o: { finalPrice: number | null; estimatedPrice: number }) {
  return o.finalPrice ?? o.estimatedPrice ?? 0;
}

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /** Директор и ops-менеджер видят компанию целиком; менеджер — только своё */
  private scope(user: AuthUser): Prisma.OrderWhereInput {
    return seesAll(user)
      ? { ...NOT_DELETED }
      : { ...NOT_DELETED, managerId: user.id };
  }

  /**
   * Границы периода по Душанбе (UTC+5).
   * Раньше считалось по времени сервера (UTC), из-за чего «сегодня» на дашборде
   * начиналось в 05:00 по местному времени, а заказ, оплаченный 1-го числа
   * в час ночи, попадал в выручку предыдущего месяца.
   */
  private rangeOf(
    period: AnalyticsPeriod,
    from?: string,
    to?: string,
  ): { gte?: Date; lte?: Date } {
    if (from || to) return momentRange(from, to);
    const now = new Date();
    switch (period) {
      case 'day':
        return { gte: startOfDay(now), lte: now };
      case 'week':
        return { gte: startOfWeek(now), lte: now };
      case 'quarter':
        return { gte: startOfQuarter(now), lte: now };
      case 'year':
        return { gte: startOfYear(now), lte: now };
      case 'all':
        return {};
      case 'month':
      default:
        return { gte: startOfMonth(now), lte: now };
    }
  }

  /** Сводка для дашборда */
  async summary(user: AuthUser) {
    const scope = this.scope(user);
    const month = this.rangeOf('month');

    const [newLeads, inProgress, doneThisMonth, totalClients] =
      await Promise.all([
        this.prisma.order.count({ where: { ...scope, stage: FunnelStage.NEW } }),
        this.prisma.order.count({
          where: { ...scope, stage: FunnelStage.IN_PROGRESS },
        }),
        this.prisma.order.count({
          where: { ...scope, stage: FunnelStage.PAID, closedAt: month },
        }),
        this.prisma.client.count({
          where: seesAll(user)
            ? { ...NOT_DELETED }
            : { ...NOT_DELETED, managerId: user.id },
        }),
      ]);

    const result: any = { newLeads, inProgress, doneThisMonth, totalClients };

    // выручка — только руководителю
    if (user.role === Role.DIRECTOR) {
      const r = await this.revenueInRange(scope, month);
      result.revenueMonth = r.revenue;
    }
    return result;
  }

  /**
   * Выручка за период. Возвращает не только сумму, но и сверку: сколько
   * оплаченных заказов не имеют суммы и сколько — даты закрытия. Раньше такие
   * заказы просто выпадали из отчётов, и цифры «не сходились» без объяснения.
   */
  private async revenueInRange(
    scope: Prisma.OrderWhereInput,
    range: { gte?: Date; lte?: Date },
  ) {
    const hasRange = range.gte !== undefined || range.lte !== undefined;

    const [orders, missingClosedAt] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          ...scope,
          stage: FunnelStage.PAID,
          ...(hasRange ? { closedAt: range } : {}),
        },
        select: { finalPrice: true, estimatedPrice: true },
      }),
      // оплачен, но даты закрытия нет — в период по дате он не попадёт никогда
      this.prisma.order.count({
        where: { ...scope, stage: FunnelStage.PAID, closedAt: null },
      }),
    ]);

    const revenue = orders.reduce((s, o) => s + priceOf(o), 0);
    const unpriced = orders.filter((o) => priceOf(o) <= 0).length;

    return { revenue, orders: orders.length, unpriced, missingClosedAt };
  }

  /** Полная аналитика. Менеджеру — без финансовых данных. */
  async full(
    user: AuthUser,
    period: AnalyticsPeriod = 'month',
    from?: string,
    to?: string,
  ) {
    const scope = this.scope(user);
    const range = this.rangeOf(period, from, to);
    const hasRange = range.gte !== undefined || range.lte !== undefined;

    /*
     * Все разрезы считаем за ОДИН И ТОТ ЖЕ период. Раньше конверсия, виды уборки
     * и источники считались за всю историю, а выручка — за выбранный период,
     * и на одном экране оказывались несопоставимые числа.
     * Период применяем по дате создания заказа: воронка — это про поступление заявок.
     */
    const periodScope: Prisma.OrderWhereInput = hasRange
      ? { ...scope, createdAt: range }
      : scope;

    const [byTypeRaw, bySourceRaw, totalOrders, paidOrders, rejectedOrders] =
      await Promise.all([
        this.prisma.order.groupBy({
          by: ['cleaningType'],
          where: periodScope,
          _count: { _all: true },
        }),
        this.prisma.order.groupBy({
          by: ['source'],
          where: periodScope,
          _count: { _all: true },
        }),
        this.prisma.order.count({ where: periodScope }),
        this.prisma.order.count({
          where: { ...periodScope, stage: FunnelStage.PAID },
        }),
        this.prisma.order.count({
          where: { ...periodScope, stage: FunnelStage.REJECTED },
        }),
      ]);

    const byType = byTypeRaw.map((r) => ({
      type: r.cleaningType,
      label: TYPE_LABEL[r.cleaningType] ?? r.cleaningType,
      count: r._count._all,
    }));
    const sources = bySourceRaw.map((r) => ({
      source: r.source,
      label: SOURCE_LABEL[r.source] ?? r.source,
      count: r._count._all,
    }));

    const conversion = {
      total: totalOrders,
      paid: paidOrders,
      rejected: rejectedOrders,
      rate: totalOrders ? Math.round((paidOrders / totalOrders) * 100) : 0,
    };

    const result: any = {
      period,
      from: range.gte ? dayKey(range.gte) : null,
      to: range.lte ? dayKey(range.lte) : null,
      byType,
      sources,
      conversion,
    };

    // Выручка — только руководителю
    if (user.role === Role.DIRECTOR) {
      const [day, week, month, quarter, current, revenueSeries] =
        await Promise.all([
          this.revenueInRange(scope, this.rangeOf('day')),
          this.revenueInRange(scope, this.rangeOf('week')),
          this.revenueInRange(scope, this.rangeOf('month')),
          this.revenueInRange(scope, this.rangeOf('quarter')),
          this.revenueInRange(scope, range),
          this.revenueSeries(scope, 14),
        ]);

      result.revenue = {
        day: day.revenue,
        week: week.revenue,
        month: month.revenue,
        quarter: quarter.revenue,
        period: current.revenue,
      };
      result.revenueSeries = revenueSeries;
      // сверка: расхождения видны сразу, а не «теряются» в цифрах
      result.reconciliation = {
        paidOrdersInPeriod: current.orders,
        ordersWithoutPrice: current.unpriced,
        paidWithoutCloseDate: month.missingClosedAt,
      };
    }

    // Загруженность менеджеров (не финансы) — директору и ops-менеджеру
    if (seesAll(user)) {
      result.managerWorkload = await this.managerWorkload();
    }

    return result;
  }

  /**
   * Расшифровка одной цифры с экрана аналитики.
   *
   * Правило кабинета: сводная цифра не тупик. Столбик диаграммы, сектор
   * «источники», карточка выручки — за каждым стоит конкретный список заказов,
   * и его должно быть видно в один клик, а не собирать руками через фильтры.
   *
   * Здесь важнее всего одно: срез считается ТЕМ ЖЕ условием, что и цифра над
   * ним. Иначе расшифровка «не сойдётся» с числом, которое её открыло, и
   * доверие к аналитике пропадёт быстрее, чем от любой ошибки в сумме.
   */
  async drilldown(
    user: AuthUser,
    metric: string,
    key?: string,
    from?: string,
    to?: string,
    period: AnalyticsPeriod = 'month',
  ) {
    /*
     * Права те же, что и у самих цифр: расшифровка не должна становиться
     * дырой, через которую менеджер увидит выручку компании или чужую
     * загруженность в обход `full()`.
     */
    const MONEY = ['revenuePeriod', 'revenueMoment', 'revenueDay', 'unpriced', 'noCloseDate'];
    const ALL_STAFF = ['managerActive', 'managerPaid'];
    if (MONEY.includes(metric) && user.role !== Role.DIRECTOR) {
      throw new ForbiddenException('Финансовые данные доступны только руководителю');
    }
    if (ALL_STAFF.includes(metric) && !seesAll(user)) {
      throw new ForbiddenException('Загруженность сотрудников доступна руководству');
    }

    const scope = this.scope(user);
    const range = this.rangeOf(period, from, to);
    const hasRange = range.gte !== undefined || range.lte !== undefined;
    // воронка/типы/источники считаются по дате создания заказа
    const periodScope: Prisma.OrderWhereInput = hasRange
      ? { ...scope, createdAt: range }
      : scope;
    // выручка — по дате закрытия
    const paidInRange: Prisma.OrderWhereInput = {
      ...scope,
      stage: FunnelStage.PAID,
      ...(hasRange ? { closedAt: range } : {}),
    };

    const activeStages: FunnelStage[] = [
      FunnelStage.NEW,
      FunnelStage.PROCESSING,
      FunnelStage.INSPECTION,
      FunnelStage.OFFER,
      FunnelStage.CONFIRMED,
      FunnelStage.IN_PROGRESS,
      FunnelStage.DONE,
    ];

    let where: Prisma.OrderWhereInput;
    switch (metric) {
      case 'type':
        where = { ...periodScope, cleaningType: key as any };
        break;
      case 'source':
        where = { ...periodScope, source: key as any };
        break;
      case 'conversionTotal':
        where = periodScope;
        break;
      /*
       * Карточки дашборда. Они показывают положение дел СЕЙЧАС, а не за период,
       * поэтому диапазон здесь сознательно не применяется — иначе расшифровка
       * покажет меньше заказов, чем написано на карточке.
       */
      case 'stageNow':
        where = { ...scope, stage: key as FunnelStage };
        break;
      case 'paidThisMonth':
        where = {
          ...scope,
          stage: FunnelStage.PAID,
          closedAt: this.rangeOf('month'),
        };
        break;
      case 'conversionPaid':
        where = { ...periodScope, stage: FunnelStage.PAID };
        break;
      case 'conversionRejected':
        where = { ...periodScope, stage: FunnelStage.REJECTED };
        break;
      case 'revenuePeriod':
        where = paidInRange;
        break;
      // карточки «за день/неделю/месяц/квартал» живут по своему окну,
      // независимо от выбранного сверху периода — расшифровка тоже
      case 'revenueMoment': {
        const r = this.rangeOf((key as AnalyticsPeriod) ?? 'day');
        where = { ...scope, stage: FunnelStage.PAID, closedAt: r };
        break;
      }
      // один столбик графика «Доход за 14 дней» — конкретный день по Душанбе
      case 'revenueDay':
        where = {
          ...scope,
          stage: FunnelStage.PAID,
          closedAt: momentRange(key, key),
        };
        break;
      case 'managerActive':
        where = {
          ...NOT_DELETED,
          stage: { in: activeStages },
          managerId: key === 'none' ? null : key,
        };
        break;
      case 'managerPaid':
        where = {
          ...NOT_DELETED,
          stage: FunnelStage.PAID,
          managerId: key === 'none' ? null : key,
        };
        break;
      // сверка: заказы, которые молча выпадают из выручки
      case 'unpriced':
        where = {
          ...paidInRange,
          OR: [
            { finalPrice: { lte: 0 } },
            { finalPrice: null, estimatedPrice: { lte: 0 } },
          ],
        };
        break;
      case 'noCloseDate':
        where = { ...scope, stage: FunnelStage.PAID, closedAt: null };
        break;
      default:
        throw new BadRequestException('Неизвестный разрез аналитики');
    }

    const orders = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        closedAt: true,
        stage: true,
        source: true,
        cleaningType: true,
        address: true,
        area: true,
        estimatedPrice: true,
        finalPrice: true,
        client: { select: { id: true, fullName: true, phone: true } },
        manager: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return {
      metric,
      key: key ?? null,
      count: orders.length,
      sum: orders.reduce((s, o) => s + priceOf(o), 0),
      orders: orders.map((o) => ({
        ...o,
        typeLabel: TYPE_LABEL[o.cleaningType] ?? o.cleaningType,
        sourceLabel: SOURCE_LABEL[o.source] ?? o.source,
        price: priceOf(o),
      })),
    };
  }

  /** Выручка по дням за последние N дней — для графика */
  private async revenueSeries(scope: Prisma.OrderWhereInput, days: number) {
    const start = startOfDay(new Date());
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const orders = await this.prisma.order.findMany({
      where: { ...scope, stage: FunnelStage.PAID, closedAt: { gte: start } },
      select: { finalPrice: true, estimatedPrice: true, closedAt: true },
    });

    // ключ корзины — календарный день ПО ДУШАНБЕ, иначе вечерние заказы
    // попадают в соседние сутки
    const buckets = new Map<string, number>();
    const order: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const key = dayKey(d);
      buckets.set(key, 0);
      order.push(key);
    }
    for (const o of orders) {
      if (!o.closedAt) continue;
      const key = dayKey(o.closedAt);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + priceOf(o));
      }
    }
    return order.map((key) => ({
      date: key.slice(5), // «07-28» — как ожидает график
      day: key, // полная дата — по ней открывается расшифровка столбика
      revenue: buckets.get(key) ?? 0,
    }));
  }

  /**
   * Загруженность по сотрудникам.
   * Берём всех, кто реально ведёт заказы, а не только роль MANAGER: заказы
   * директора раньше не попадали в отчёт вообще, и сумма по строкам не сходилась
   * с общим числом заказов.
   */
  private async managerWorkload() {
    const activeStages: FunnelStage[] = [
      FunnelStage.NEW,
      FunnelStage.PROCESSING,
      FunnelStage.INSPECTION,
      FunnelStage.OFFER,
      FunnelStage.CONFIRMED,
      FunnelStage.IN_PROGRESS,
      FunnelStage.DONE,
    ];

    const [users, activeGroups, paidGroups, unassignedActive, unassignedPaid] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { ...NOT_DELETED },
          select: { id: true, fullName: true, role: true },
          orderBy: { fullName: 'asc' },
        }),
        this.prisma.order.groupBy({
          by: ['managerId'],
          where: {
            ...NOT_DELETED,
            stage: { in: activeStages },
            managerId: { not: null },
          },
          _count: { _all: true },
        }),
        this.prisma.order.groupBy({
          by: ['managerId'],
          where: {
            ...NOT_DELETED,
            stage: FunnelStage.PAID,
            managerId: { not: null },
          },
          _count: { _all: true },
        }),
        this.prisma.order.count({
          where: { ...NOT_DELETED, stage: { in: activeStages }, managerId: null },
        }),
        this.prisma.order.count({
          where: { ...NOT_DELETED, stage: FunnelStage.PAID, managerId: null },
        }),
      ]);

    const activeBy = new Map(
      activeGroups.map((g) => [g.managerId, g._count._all]),
    );
    const paidBy = new Map(paidGroups.map((g) => [g.managerId, g._count._all]));

    const rows = users
      .map((u) => ({
        id: u.id,
        name: u.fullName,
        active: activeBy.get(u.id) ?? 0,
        paid: paidBy.get(u.id) ?? 0,
      }))
      // сотрудников без единого заказа в отчёте не показываем — это шум
      .filter((r) => r.active > 0 || r.paid > 0);

    // заказы без ответственного тоже должны быть видны, иначе итог не сойдётся
    if (unassignedActive > 0 || unassignedPaid > 0) {
      rows.push({
        id: 'unassigned',
        name: 'Без ответственного',
        active: unassignedActive,
        paid: unassignedPaid,
      });
    }
    return rows;
  }
}
