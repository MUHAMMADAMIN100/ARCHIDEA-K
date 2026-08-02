import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  CallType,
  CleaningType,
  FunnelStage,
  LeadSource,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { NOT_DELETED } from '../common/soft-delete';
import {
  dayKey,
  momentRange,
  rangeUTC,
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
  ANISA: 'От Анисы',
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
      /*
       * KPI по менеджерам открыт тому, кто ведёт всю компанию, — как и
       * разрезы продаж. Обычный менеджер видит только свои заказы, чужих
       * показателей ему не отдаём.
       */
      result.managerKpi = await this.managerKpi(
        periodScope,
        hasRange ? { gte: range.gte, lte: range.lte } : undefined,
      );

      /*
       * Разрезы. Деньги в них видит только руководитель, поэтому
       * ops-менеджеру суммы обнуляем, а количества оставляем — они не финансы.
       */
      const paidInRange: Prisma.OrderWhereInput = hasRange
        ? { ...scope, stage: FunnelStage.PAID, closedAt: range }
        : { ...scope, stage: FunnelStage.PAID };
      // границы для выездов: тот же период, но по дню-снапшоту
      const dayRange = hasRange
        ? rangeUTC(
            range.gte ? dayKey(range.gte) : undefined,
            range.lte ? dayKey(range.lte) : undefined,
          )
        : undefined;
      const rows = await this.breakdowns(periodScope, paidInRange, dayRange);
      /*
       * Два разных уровня доступа к цифрам, и путать их нельзя.
       *
       *  - КАССА (finance:view, только руководитель): выручка компании,
       *    начисления клинерам, скидки и доход от доп. услуг одной строкой.
       *  - ПРОДАЖИ (seesAll): кто сколько продал — суммы по менеджерам,
       *    услугам, клиентам и источникам. Без этого нельзя управлять
       *    менеджерами, поэтому они открыты тому, кто ведёт всю компанию.
       *
       * Менеджеру со своей областью данных по-прежнему не видно ни того,
       * ни другого: он и так смотрит только на собственные заказы.
       */
      const seesMoney = user.role === Role.DIRECTOR;
      const seesSales = seesAll(user);
      result.breakdowns = seesMoney
        ? rows
        : {
            ...rows,
            // начисления клинерам — зарплата, её видит только руководитель
            brigades: rows.brigades.map((r) => ({ ...r, accrued: 0 })),
            cleaners: rows.cleaners.map((r) => ({ ...r, accrued: 0 })),
            ...(seesSales
              ? {}
              : {
                  managers: rows.managers.map((m) => ({
                    ...m,
                    amount: 0,
                    average: 0,
                  })),
                  services: rows.services.map((r) => ({ ...r, amount: 0 })),
                  extras: rows.extras.map((r) => ({ ...r, amount: 0 })),
                  clients: rows.clients.map((r) => ({ ...r, amount: 0 })),
                  sourceRows: rows.sourceRows.map((r) => ({ ...r, amount: 0 })),
                }),
            totals: {
              ...rows.totals,
              // сводная выручка компании и её производные — только касса
              revenue: 0,
              average: 0,
              discountTotal: 0,
              extrasRevenue: 0,
            },
          };
    }

    return result;
  }


  /**
   * Разрезы за выбранный период: кто сколько принял и что сколько принесло.
   *
   * Сводные цифры сверху отвечают на «сколько всего», но не на «за счёт кого
   * и чего». Раньше этих ответов в аналитике не было вовсе — руководитель
   * собирал их руками по воронке и ведомостям.
   *
   * Всё считается ОДНИМ условием периода — тем же, что и цифры выше, иначе
   * разрезы не сойдутся с итогом и доверие к аналитике пропадёт.
   */
  private async breakdowns(
    periodScope: Prisma.OrderWhereInput,
    paidInRange: Prisma.OrderWhereInput,
    dayRange?: { gte?: Date; lte?: Date },
  ) {
    const [orders, paid, extrasCatalogue, brigades, shiftGroups] =
      await Promise.all([
        // все обращения периода — для конверсии по менеджеру и источнику
        this.prisma.order.findMany({
          where: periodScope,
          select: {
            id: true,
            stage: true,
            source: true,
            managerId: true,
            manager: { select: { fullName: true } },
          },
        }),
        // оплаченные — для денег
        this.prisma.order.findMany({
          where: paidInRange,
          select: {
            id: true,
            source: true,
            serviceKey: true,
            cleaningType: true,
            finalPrice: true,
            estimatedPrice: true,
            discount: true,
            extras: true,
            managerId: true,
            manager: { select: { fullName: true } },
            client: { select: { id: true, fullName: true } },
          },
        }),
        this.prisma.extraService.findMany({
          where: NOT_DELETED,
          select: { key: true, title: true, price: true, hasQty: true },
        }),
        this.prisma.brigade.findMany({
          select: {
            id: true,
            name: true,
            leader: { select: { fullName: true } },
          },
        }),
        this.prisma.shiftGroup.findMany({
          // дата выезда хранится днём-снапшотом (полночь UTC) — свой диапазон
          where: { ...NOT_DELETED, ...(dayRange ? { date: dayRange } : {}) },
          select: {
            id: true,
            brigadeId: true,
            brigadeName: true,
            members: { select: { cleanerId: true, fullName: true, rate: true } },
          },
        }),
      ]);

    const money = (o: { finalPrice: number | null; estimatedPrice: number }) =>
      o.finalPrice ?? o.estimatedPrice ?? 0;

    // ── менеджеры: обращения, оплачено, деньги, средний чек
    const byManager = new Map<
      string,
      { id: string | null; name: string; total: number; paid: number; amount: number }
    >();
    const mgrRow = (id: string | null, name: string) => {
      const key = id ?? 'none';
      if (!byManager.has(key)) {
        byManager.set(key, { id, name, total: 0, paid: 0, amount: 0 });
      }
      return byManager.get(key)!;
    };
    for (const o of orders) {
      mgrRow(o.managerId, o.manager?.fullName ?? 'без менеджера').total += 1;
    }
    for (const o of paid) {
      const row = mgrRow(o.managerId, o.manager?.fullName ?? 'без менеджера');
      row.paid += 1;
      row.amount += money(o);
    }
    const managers = [...byManager.values()]
      .map((r) => ({
        ...r,
        average: r.paid ? Math.round(r.amount / r.paid) : 0,
      }))
      .sort((a, b) => b.amount - a.amount || b.total - a.total);

    // ── услуги: сколько заказов и денег принесла каждая
    const byService = new Map<string, { key: string; label: string; count: number; amount: number }>();
    for (const o of paid) {
      const key = o.serviceKey || o.cleaningType;
      const label = TYPE_LABEL[o.cleaningType] ?? key;
      const row = byService.get(key) ?? { key, label, count: 0, amount: 0 };
      row.count += 1;
      row.amount += money(o);
      byService.set(key, row);
    }
    const services = [...byService.values()].sort((a, b) => b.amount - a.amount);

    // ── доп. услуги: сколько раз брали и на какую сумму
    const byExtra = new Map<string, { key: string; label: string; count: number; amount: number }>();
    for (const o of paid) {
      const chosen = (o.extras as Record<string, number> | null) ?? null;
      if (!chosen) continue;
      for (const [key, rawQty] of Object.entries(chosen)) {
        const item = extrasCatalogue.find((e) => e.key === key);
        if (!item) continue;
        const qty = Math.max(0, Math.round(Number(rawQty) || 0));
        if (qty === 0) continue;
        const row = byExtra.get(key) ?? { key, label: item.title, count: 0, amount: 0 };
        row.count += 1;
        row.amount += item.hasQty ? item.price * qty : item.price;
        byExtra.set(key, row);
      }
    }
    const extras = [...byExtra.values()].sort((a, b) => b.amount - a.amount);

    // ── бригады и клинеры: выезды, смены, начислено
    const byBrigade = new Map<
      string,
      { id: string | null; name: string; leader: string | null; visits: number; shifts: number; accrued: number }
    >();
    const byCleaner = new Map<
      string,
      { id: string; name: string; shifts: number; accrued: number }
    >();
    for (const g of shiftGroups) {
      const key = g.brigadeId ?? 'none';
      const info = brigades.find((b) => b.id === g.brigadeId);
      const row =
        byBrigade.get(key) ??
        {
          id: g.brigadeId,
          name: g.brigadeName ?? info?.name ?? 'без бригады',
          leader: info?.leader?.fullName ?? null,
          visits: 0,
          shifts: 0,
          accrued: 0,
        };
      row.visits += 1;
      row.shifts += g.members.length;
      row.accrued += g.members.reduce((sum, m) => sum + m.rate, 0);
      byBrigade.set(key, row);

      for (const m of g.members) {
        if (!m.cleanerId) continue; // разовый клинер — без персонального разреза
        const c = byCleaner.get(m.cleanerId) ?? {
          id: m.cleanerId,
          name: m.fullName,
          shifts: 0,
          accrued: 0,
        };
        c.shifts += 1;
        c.accrued += m.rate;
        byCleaner.set(m.cleanerId, c);
      }
    }
    const brigadeRows = [...byBrigade.values()].sort((a, b) => b.visits - a.visits);
    const cleanerRows = [...byCleaner.values()]
      .sort((a, b) => b.shifts - a.shifts)
      .slice(0, 30);

    // ── клиенты: топ по деньгам
    const byClient = new Map<string, { id: string; name: string; count: number; amount: number }>();
    for (const o of paid) {
      if (!o.client) continue;
      const row =
        byClient.get(o.client.id) ??
        { id: o.client.id, name: o.client.fullName, count: 0, amount: 0 };
      row.count += 1;
      row.amount += money(o);
      byClient.set(o.client.id, row);
    }
    const clients = [...byClient.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20);

    // ── источники: не только обращения, но и деньги
    const bySource = new Map<
      string,
      { source: string; label: string; total: number; paid: number; amount: number }
    >();
    const srcRow = (source: string) => {
      if (!bySource.has(source)) {
        bySource.set(source, {
          source,
          label: SOURCE_LABEL[source as LeadSource] ?? source,
          total: 0,
          paid: 0,
          amount: 0,
        });
      }
      return bySource.get(source)!;
    };
    for (const o of orders) srcRow(o.source).total += 1;
    for (const o of paid) {
      const row = srcRow(o.source);
      row.paid += 1;
      row.amount += money(o);
    }
    const sourceRows = [...bySource.values()].sort((a, b) => b.amount - a.amount);

    // ── итоги периода для карточек
    const revenue = paid.reduce((sum, o) => sum + money(o), 0);
    const discountTotal = paid.reduce((sum, o) => sum + (o.discount ?? 0), 0);
    const extrasRevenue = extras.reduce((sum, e) => sum + e.amount, 0);

    return {
      managers,
      services,
      extras,
      brigades: brigadeRows,
      cleaners: cleanerRows,
      clients,
      sourceRows,
      totals: {
        paidOrders: paid.length,
        revenue,
        average: paid.length ? Math.round(revenue / paid.length) : 0,
        discountTotal,
        extrasRevenue,
      },
    };
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
    const ALL_STAFF = [
      'managerActive',
      'managerPaid',
      'managerOrders',
      'managerPaidOrders',
    ];
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

    /*
     * Выезды бригады и смены клинера — не заказы, у них свой ответ.
     * «26 смен» в разрезе должно раскрываться в конкретные дни и адреса.
     */
    if (metric === 'brigadeVisits' || metric === 'cleanerShifts') {
      if (!seesAll(user)) {
        throw new ForbiddenException('Доступно руководству');
      }
      const dayRange = hasRange
        ? rangeUTC(
            range.gte ? dayKey(range.gte) : undefined,
            range.lte ? dayKey(range.lte) : undefined,
          )
        : undefined;
      const groups = await this.prisma.shiftGroup.findMany({
        where: {
          ...NOT_DELETED,
          ...(dayRange ? { date: dayRange } : {}),
          ...(metric === 'brigadeVisits'
            ? { brigadeId: key === 'none' ? null : key }
            : { members: { some: { cleanerId: key } } }),
        },
        select: {
          id: true,
          date: true,
          address: true,
          startTime: true,
          status: true,
          brigadeName: true,
          managerName: true,
          members: {
            select: { cleanerId: true, fullName: true, rate: true, role: true },
          },
        },
        orderBy: { date: 'desc' },
        take: 300,
      });
      const showMoney = user.role === Role.DIRECTOR;
      if (metric === 'brigadeVisits') {
        return {
          metric,
          key: key ?? null,
          kind: 'visits',
          rows: groups.map((g) => ({
            id: g.id,
            date: g.date,
            address: g.address,
            startTime: g.startTime,
            status: g.status,
            managerName: g.managerName,
            members: g.members.map((m) => m.fullName),
            shifts: g.members.length,
            accrued: showMoney
              ? g.members.reduce((sum, m) => sum + m.rate, 0)
              : null,
          })),
        };
      }
      // смены конкретного клинера: день, адрес, роль и ставка на выезде
      const rows = groups.map((g) => {
        const me = g.members.find((m) => m.cleanerId === key);
        return {
          id: g.id,
          date: g.date,
          address: g.address,
          startTime: g.startTime,
          status: g.status,
          brigadeName: g.brigadeName,
          role: me?.role ?? null,
          rate: showMoney ? (me?.rate ?? null) : null,
        };
      });
      return { metric, key: key ?? null, kind: 'shifts', rows };
    }
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
      /*
       * Разрезы за период: услуга, доп. услуга и клиент раскрываются в те же
       * оплаченные заказы, из которых сложилась их строка. Условие — то же,
       * что в breakdowns(): stage PAID + closedAt в диапазоне.
       */
      case 'serviceOrders': {
        const paidScope: Prisma.OrderWhereInput = {
          ...scope,
          stage: FunnelStage.PAID,
          ...(hasRange ? { closedAt: range } : {}),
        };
        const isBaseType = (Object.values(CleaningType) as string[]).includes(
          key ?? '',
        );
        where = {
          ...paidScope,
          OR: [
            { serviceKey: key },
            ...(isBaseType
              ? [{ serviceKey: null, cleaningType: key as CleaningType }]
              : []),
          ],
        };
        break;
      }
      case 'clientOrders':
        where = {
          ...scope,
          stage: FunnelStage.PAID,
          ...(hasRange ? { closedAt: range } : {}),
          clientId: key,
        };
        break;
      case 'extraOrders': {
        // extras — JSON «ключ → количество»: отбираем в памяти, где ключ выбран
        const paid = await this.prisma.order.findMany({
          where: {
            ...scope,
            stage: FunnelStage.PAID,
            ...(hasRange ? { closedAt: range } : {}),
          },
          select: { id: true, extras: true },
        });
        const ids = paid
          .filter((o) => {
            const chosen = (o.extras as Record<string, number> | null) ?? null;
            return !!chosen && Number(chosen[key ?? '']) > 0;
          })
          .map((o) => o.id);
        where = { id: { in: ids } };
        break;
      }
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
      /*
       * Разрезы по менеджеру — за ВЫБРАННЫЙ период, в отличие от managerActive
       * и managerPaid, которые показывают текущую загруженность за всё время.
       */
      case 'managerOrders':
        where = { ...periodScope, managerId: key === 'none' ? null : key };
        break;
      case 'managerPaidOrders':
        where = { ...paidInRange, managerId: key === 'none' ? null : key };
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
  /**
   * KPI по каждому менеджеру за период.
   *
   * Всё считается по обращениям, СОЗДАННЫМ в периоде: сколько взял, сколько
   * довёл до оплаты, сколько потерял. Иначе конверсия сравнивала бы заявки
   * этого месяца с оплатами прошлого и всегда врала.
   *
   * Звонки — клиенты, у которых менеджер отметил тип разговора. Отдельного
   * журнала звонков в системе нет: тип ставится в карточке клиента, и вместе
   * с ним обновляется дата последнего контакта — по ней и считаем период.
   */
  private async managerKpi(
    periodScope: Prisma.OrderWhereInput,
    clientRange?: { gte?: Date; lte?: Date },
  ) {
    const hasClientRange =
      clientRange && (clientRange.gte !== undefined || clientRange.lte !== undefined);
    const clientWhere: Prisma.ClientWhereInput = { ...NOT_DELETED };
    const [users, orders, clientsNew, callRows] = await Promise.all([
      this.prisma.user.findMany({
        where: { ...NOT_DELETED },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.order.findMany({
        where: periodScope,
        select: {
          stage: true,
          managerId: true,
          finalPrice: true,
          estimatedPrice: true,
          manager: { select: { fullName: true } },
        },
      }),
      this.prisma.client.groupBy({
        by: ['managerId'],
        where: hasClientRange
          ? { ...clientWhere, createdAt: clientRange }
          : clientWhere,
        _count: { _all: true },
      }),
      this.prisma.client.groupBy({
        by: ['managerId', 'callType'],
        where: hasClientRange
          ? { ...clientWhere, callType: { not: null }, lastContactAt: clientRange }
          : { ...clientWhere, callType: { not: null } },
        _count: { _all: true },
      }),
    ]);

    type Row = {
      id: string | null;
      name: string;
      calls: number;
      cold: number;
      neutral: number;
      hot: number;
      newClients: number;
      orders: number;
      paid: number;
      rejected: number;
      amount: number;
      conversion: number;
    };
    const by = new Map<string, Row>();
    const row = (id: string | null, name: string): Row => {
      const key = id ?? 'none';
      if (!by.has(key)) {
        by.set(key, {
          id,
          name,
          calls: 0,
          cold: 0,
          neutral: 0,
          hot: 0,
          newClients: 0,
          orders: 0,
          paid: 0,
          rejected: 0,
          amount: 0,
          conversion: 0,
        });
      }
      return by.get(key)!;
    };
    const nameOf = (id: string | null) =>
      users.find((u) => u.id === id)?.fullName ?? 'Без ответственного';

    const money = (o: { finalPrice: number | null; estimatedPrice: number }) =>
      o.finalPrice ?? o.estimatedPrice ?? 0;

    for (const o of orders) {
      const r = row(o.managerId, o.manager?.fullName ?? 'Без ответственного');
      r.orders += 1;
      if (o.stage === FunnelStage.PAID) {
        r.paid += 1;
        r.amount += money(o);
      }
      if (o.stage === FunnelStage.REJECTED) r.rejected += 1;
    }
    for (const g of clientsNew) {
      row(g.managerId, nameOf(g.managerId)).newClients += g._count._all;
    }
    for (const g of callRows) {
      const r = row(g.managerId, nameOf(g.managerId));
      r.calls += g._count._all;
      if (g.callType === CallType.COLD) r.cold += g._count._all;
      if (g.callType === CallType.NEUTRAL) r.neutral += g._count._all;
      if (g.callType === CallType.HOT) r.hot += g._count._all;
    }

    return [...by.values()]
      .map((r) => ({
        ...r,
        conversion: r.orders ? Math.round((r.paid / r.orders) * 100) : 0,
      }))
      // сотрудники, за которыми в периоде вообще ничего нет, — это шум
      .filter((r) => r.orders > 0 || r.calls > 0 || r.newClients > 0)
      .sort((a, b) => b.paid - a.paid || b.orders - a.orders);
  }

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
