import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ClientTag,
  DirtLevel,
  FunnelStage,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { FinanceService } from '../finance/finance.service';
import { ReportsService } from '../reports/reports.service';
import { ShiftGroupsService } from '../payroll/shift-groups.service';
import { TelegramService } from '../telegram/telegram.service';
import { escapeHtml } from '../telegram/telegram.util';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { seesFinance } from '../common/permissions';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { resolveManager } from '../common/resolve-manager';
import { formatDate, parseDate } from '../common/time/dushanbe';
import {
  calculatePrice,
  PricingExtra,
  PricingTariff,
  unitPrice,
} from './order-pricing';
import {
  AssignCleanersDto,
  ChangeStageDto,
  CreateOrderDto,
  UpdateOrderDto,
} from './dto/order.dto';

/** Порог «крупного заказа» (сомони) — для уведомления руководителю */
const LARGE_ORDER_THRESHOLD = 2000;

const STAGE_LABEL: Record<FunnelStage, string> = {
  NEW: 'Новая заявка',
  PROCESSING: 'Обработка',
  INSPECTION: 'Осмотр объекта',
  OFFER: 'Коммерческое предложение',
  CONFIRMED: 'Подтверждён',
  IN_PROGRESS: 'В работе',
  DONE: 'К оплате',
  PAID: 'Оплачено / Закрыто',
  REJECTED: 'Отказ',
};

/** Состав списка воронки — лёгкий, без вложенных выездов */
const orderInclude = {
  client: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      // статус клиента виден прямо на карточке воронки
      tags: true,
    },
  },
  manager: { select: { id: true, fullName: true } },
  cleaners: { select: { id: true, fullName: true } },
};

/**
 * Состав карточки заказа (ТЗ 3.2): кроме назначенной команды и менеджера
 * подтягиваем выезды — именно из них видно, кто и когда реально был на объекте.
 */
const orderDetailInclude = {
  ...orderInclude,
  client: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      tags: true,
      extraPhones: true,
      // постоянная скидка клиента: подставляется в заказ, если своя не задана
      discount: true,
      preferences: true,
      isRepeat: true,
      paidOrdersCount: true,
    },
  },
  // Внесённые оплаты (ТЗ 3.1): приходят вместе с заказом, чтобы карточка
  // показывала историю взносов без второго запроса
  payments: {
    where: NOT_DELETED,
    orderBy: { paidAt: 'asc' as const },
    select: {
      id: true,
      amount: true,
      method: true,
      note: true,
      paidAt: true,
      createdByName: true,
      bank: { select: { id: true, title: true } },
    },
  },
  shiftGroups: {
    where: NOT_DELETED,
    orderBy: { date: 'desc' as const },
    select: {
      id: true,
      date: true,
      address: true,
      startTime: true,
      endTime: true,
      status: true,
      brigadeName: true,
      brigadierName: true,
      managerName: true,
      closedAt: true,
      members: {
        select: { id: true, cleanerId: true, fullName: true, role: true },
      },
    },
  },
};

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private audit: AuditService,
    private finance: FinanceService,
    private telegram: TelegramService,
    private reports: ReportsService,
    private shiftGroups: ShiftGroupsService,
  ) {}

  private scopeWhere(user: AuthUser): Prisma.OrderWhereInput {
    return seesAll(user) ? { ...NOT_DELETED } : { ...NOT_DELETED, managerId: user.id };
  }

  private titleOf(order: {
    client?: { fullName?: string } | null;
    area?: number | null;
  }): string {
    const name = order.client?.fullName ?? 'Клиент';
    return order.area ? `Заказ — ${name}, ${order.area} м²` : `Заказ — ${name}`;
  }

  /**
   * Проверяем, что все переданные клинеры существуют, активны и не в корзине.
   * Раньше несуществующий идентификатор доходил до Prisma и превращался
   * в 500-ю ошибку вместо понятного сообщения.
   */
  private async resolveCleaners(ids: string[] | undefined): Promise<string[]> {
    if (!ids || ids.length === 0) return [];
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];

    const found = await this.prisma.cleaner.findMany({
      where: { id: { in: unique }, isActive: true, ...NOT_DELETED },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException(
        'Часть выбранных клинеров недоступна: они уволены или удалены. Обновите страницу и выберите заново.',
      );
    }
    return found.map((c) => c.id);
  }

  /**
   * Справочник доп. услуг для расчёта. Берём активные и не удалённые:
   * цена доп. услуги — тоже цена компании, из браузера её не принимаем.
   */
  private extrasCatalogue(): Promise<PricingExtra[]> {
    return this.prisma.extraService.findMany({
      where: { ...NOT_DELETED, isActive: true },
      select: { key: true, price: true, hasQty: true },
    });
  }

  /**
   * Строки дополнительных основных услуг (ТЗ 1.3) со снапшотом цены.
   *
   * Цена за единицу: ручная, если менеджер её задал, иначе из справочника по
   * степени загрязнения заявки. Название и единица фиксируются в строке,
   * чтобы история заказа не менялась от последующих правок справочника.
   */
  private async enrichAdditional(
    rows: { key: string; qty: number; pricePerUnit?: number }[] | undefined,
    dirtLevel: DirtLevel | null,
  ): Promise<
    | {
        key: string;
        title: string;
        unit: string;
        qty: number;
        pricePerUnit: number;
        total: number;
      }[]
    | null
  > {
    if (!rows || rows.length === 0) return rows === undefined ? null : [];
    const tariffs = await this.prisma.tariff.findMany({
      where: { key: { in: rows.map((r) => r.key) } },
      select: {
        key: true,
        title: true,
        unit: true,
        hasLevels: true,
        priceLight: true,
        priceMedium: true,
        priceHeavy: true,
        pricePerSqm: true,
      },
    });
    return rows.map((r) => {
      const t = tariffs.find((x) => x.key === r.key);
      const manual = Math.round(Number(r.pricePerUnit) || 0);
      const price = manual > 0 ? manual : unitPrice(t ?? null, dirtLevel);
      const qty = Math.max(1, Math.round(Number(r.qty) || 1));
      return {
        key: r.key,
        title: t?.title ?? r.key,
        unit: t?.unit ?? 'м²',
        qty,
        pricePerUnit: price,
        total: Math.min(qty * price, 2_000_000_000),
      };
    });
  }

  /** Услуга заказа для расчёта цены (ТЗ 5) */
  private async tariffFor(
    serviceKey?: string | null,
  ): Promise<PricingTariff | null> {
    if (!serviceKey) return null;
    return this.prisma.tariff.findFirst({
      where: { key: serviceKey },
      select: {
        key: true,
        unit: true,
        hasLevels: true,
        priceLight: true,
        priceMedium: true,
        priceHeavy: true,
        pricePerSqm: true,
      },
    });
  }

  /**
   * Сколько закрытых карточек держит колонка (решение владельца).
   *
   * Доска показывает работу, а не историю: без предела «Оплачено»
   * разрасталось до десятков карточек, и найти среди них свежую было нельзя.
   * В колонке остаются 20 самых свежих по дате закрытия, остальные уезжают
   * в папку «Архив» на колонке. Прежнее правило «45 дней после закрытия»
   * убрано по просьбе владельца: количество — единственный критерий.
   */
  private static readonly KEEP_CLOSED_ON_BOARD = 20;

  /** Этапы, у которых есть папка «Архив» */
  private static readonly CLOSED_STAGES: FunnelStage[] = [
    FunnelStage.PAID,
    FunnelStage.REJECTED,
  ];

  /**
   * Порядок «свежие сверху» для закрытых этапов — по дате оформления.
   *
   * Именно по ней, а не по дате закрытия: дата оформления написана на самой
   * карточке, и человек судит о «старом» и «свежем» по ней. У сделки,
   * внесённой задним числом, дата закрытия — сегодняшняя (её ставит система
   * при переводе в «Оплачено»), и сортировка по ней поднимала июньские
   * карточки на самый верх колонки — «почему тут старые заказы первыми?».
   *
   * Тот же порядок обязан использоваться и доской, и архивом: граница
   * «первые 20» должна проходить по одному и тому же месту, иначе заказ
   * мог бы показаться в обоих списках или пропасть из обоих. Второй ключ —
   * идентификатор — разводит заказы, оформленные в одну секунду.
   */
  private static readonly CLOSED_ORDER: Prisma.OrderOrderByWithRelationInput[] =
    [{ createdAt: 'desc' }, { id: 'desc' }];

  list(
    user: AuthUser,
    q: {
      stage?: FunnelStage;
      managerId?: string;
      search?: string;
    },
  ) {
    const where: Prisma.OrderWhereInput = this.scopeWhere(user);
    if (q.stage) where.stage = q.stage;
    if (seesAll(user) && q.managerId) where.managerId = q.managerId;
    if (q.search) {
      const term = q.search.trim();
      const isPhoneQuery = /^[\d\s+\-()]+$/.test(term);
      const digits = term.replace(/\D/g, '');
      where.client = {
        OR: [
          { fullName: { contains: term, mode: 'insensitive' } },
          // по телефону — только если запрос похож на номер
          ...(isPhoneQuery && digits ? [{ phone: { contains: digits } }] : []),
        ],
      };
    }
    return this.prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Доска воронки: заказы, сгруппированные по этапам */
  async board(user: AuthUser) {
    const orders = await this.list(user, {});

    /*
     * Сколько всего раз клиент к нам обращался — считаем по всем его
     * заказам, включая архивные и чужие. Из этого числа воронка рисует
     * мигающую точку: человек пришёл во второй раз.
     */
    const clientIds = [
      ...new Set(orders.map((o) => o.clientId).filter(Boolean)),
    ];
    const totals = clientIds.length
      ? await this.prisma.order.groupBy({
          by: ['clientId'],
          where: { clientId: { in: clientIds }, ...NOT_DELETED },
          _count: { _all: true },
        })
      : [];
    const totalBy = new Map(totals.map((t) => [t.clientId, t._count._all]));
    for (const o of orders) {
      if (o.client) {
        (o.client as { ordersTotal?: number }).ordersTotal =
          totalBy.get(o.clientId) ?? 1;
      }
    }
    /*
     * «Обработка» и «КП» исключены из процесса (ТЗ 3): колонки не показываем.
     * Значения остаются в перечислении ради истории — существующие сделки
     * миграция перенесла на соседние этапы.
     */
    const HIDDEN: FunnelStage[] = [FunnelStage.PROCESSING, FunnelStage.OFFER];
    const stages = (Object.keys(STAGE_LABEL) as FunnelStage[]).filter(
      (s) => !HIDDEN.includes(s),
    );
    return stages.map((stage) => {
      const inStage = orders.filter((o) => o.stage === stage);

      /*
       * Закрытая колонка держит только свежую двадцатку — по дате оформления
       * (см. CLOSED_ORDER: почему не по дате закрытия). Остальное числится в
       * папке «Архив»: на доске от него только счётчик, содержимое
       * подтягивается отдельным запросом, когда папку открыли.
       */
      const closed = OrdersService.CLOSED_STAGES.includes(stage);
      const shown = closed
        ? [...inStage]
            .sort(
              (a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime() ||
                (b.id > a.id ? 1 : -1),
            )
            .slice(0, OrdersService.KEEP_CLOSED_ON_BOARD)
        : inStage;

      return {
        stage,
        label: STAGE_LABEL[stage],
        /*
         * Сумма денег на этапе — ПОЛНАЯ стоимость заказов, то есть сколько
         * компания на этом шаге заработала, ВКЛЮЧАЯ уехавшее в папку:
         * переезд карточки в архив не должен «худить» этап — деньги-то
         * получены. Раньше здесь был остаток к получению, и после частичной
         * оплаты этап «худел». Недоплата — отдельной строкой «Из них долг».
         */
        amount: inStage.reduce(
          (sum, o) => sum + (o.finalPrice ?? o.estimatedPrice ?? 0),
          0,
        ),
        /** Из этой суммы ещё не получено — остаток по частично оплаченным */
        debt: inStage.reduce(
          (sum, o) =>
            sum +
            ((o.paidAmount ?? 0) > 0
              ? Math.max(
                  0,
                  (o.finalPrice ?? o.estimatedPrice ?? 0) - (o.paidAmount ?? 0),
                )
              : 0),
          0,
        ),
        orders: shown,
        /** сколько закрытых заказов этапа лежит в папке «Архив» */
        archived: inStage.length - shown.length,
      };
    });
  }

  /**
   * Папка «Архив» этапа: всё, что не поместилось в двадцатку колонки.
   *
   * Отдельным запросом, а не вместе с доской: архив открывают редко, и
   * тянуть его на каждое обновление воронки незачем. Порядок сортировки
   * ОБЯЗАН совпадать с доской — граница «первые 20» проходит по одному и
   * тому же месту. Вернуть заказ в работу можно как обычно — сменить этап
   * в карточке, и он снова окажется в колонке.
   */
  archive(user: AuthUser, stage: FunnelStage, take = 200) {
    return this.prisma.order.findMany({
      where: {
        ...this.scopeWhere(user),
        stage,
      },
      include: orderInclude,
      orderBy: OrdersService.CLOSED_ORDER,
      skip: OrdersService.KEEP_CLOSED_ON_BOARD,
      take: Math.min(Math.max(1, take), 500),
    });
  }

  async getOne(user: AuthUser, id: string) {
    // findFirst, а не findUnique: нужен фильтр по корзине вместе с идентификатором
    const order = await this.prisma.order.findFirst({
      where: { id, ...NOT_DELETED },
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (!seesAll(user) && order.managerId !== user.id) {
      // тот же текст, что и «не найден» — чтобы нельзя было перебором
      // узнать, какие идентификаторы заказов существуют
      throw new NotFoundException('Заказ не найден');
    }
    return order;
  }

  async create(user: AuthUser, dto: CreateOrderDto) {
    // менеджер может создавать заказ только своему клиенту
    const client = await this.prisma.client.findFirst({
      where: { id: dto.clientId, ...NOT_DELETED },
      select: { id: true, managerId: true, fullName: true },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    if (!seesAll(user) && client.managerId !== user.id) {
      throw new NotFoundException('Клиент не найден');
    }

    const cleanerIds = await this.resolveCleaners(dto.cleanerIds);
    /*
     * Ответственного за заказ назначает любой сотрудник — то же правило, что
     * и для клиента. Раньше выбор менеджера сервер игнорировал и подставлял
     * создателя, из-за чего передать заказ коллеге было нельзя.
     */
    const managerId = await resolveManager(this.prisma, user, dto.managerId);
    const cleaningType = dto.cleaningType ?? 'GENERAL';
    const serviceKey = dto.serviceKey?.trim() || cleaningType;
    const dirtLevel = cleaningType === 'FURNITURE' ? null : dto.dirtLevel ?? null;

    // Цену считаем на сервере (ТЗ 5), из браузера её не принимаем
    const [tariff, extrasList] = await Promise.all([
      this.tariffFor(serviceKey),
      this.extrasCatalogue(),
    ]);
    /*
     * Скидка: если в заказе не задана, берём постоянную скидку клиента —
     * так постоянному клиенту не нужно каждый раз вписывать её вручную.
     */
    const clientDiscount = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
      select: { discount: true },
    });
    const discount = dto.discount ?? clientDiscount?.discount ?? 0;
    // дополнительные основные услуги (ТЗ 1.3): снапшот строк + их сумма
    const additional = await this.enrichAdditional(
      dto.additionalServices,
      dirtLevel,
    );
    const additionalWork = (additional ?? []).reduce(
      (sum, r) => sum + r.total,
      0,
    );
    const priced = calculatePrice(
      {
        serviceKey,
        area: dto.area,
        seats: dto.seats,
        dirtLevel,
        pricePerSqm: dto.pricePerSqm,
        extras: dto.extras,
        discount,
        additionalWork,
      },
      tariff,
      extrasList,
    );
    const isManualPrice =
      dto.finalPrice !== undefined && dto.finalPrice !== priced.total;
    const finalPrice = dto.finalPrice ?? priced.total;
    const estimatedPrice = dto.estimatedPrice ?? priced.total;

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          clientId: dto.clientId,
          managerId,
          cleaningType,
          serviceKey,
          dirtLevel,
          area: dto.area ?? 0,
          seats: dto.seats ?? null,
          address: dto.address,
          estimatedPrice,
          pricePerSqm: priced.pricePerUnit || null,
          finalPrice: finalPrice || null,
          isManualPrice,
          preferences: dto.preferences?.trim() || null,
          source: dto.source ?? 'CALL',
          comment: dto.comment,
          sourceDetail: dto.sourceDetail?.trim() || null,
          discount,
          // оплата вносится взносами (ТЗ 3.1) — новый заказ всегда неоплачен
          paidAmount: 0,
          /*
           * Доп. услуги сохраняем в самом заказе, а не только учитываем в цене.
           *
           * Раньше они участвовали в расчёте и исчезали: в карточке заказа
           * галочки стояли пустыми, хотя клиент за окна заплатил. Хуже другое —
           * при первой же правке заказа пересчёт брал пустой список, и сумма
           * падала ровно на стоимость доп. услуг.
           */
          ...(dto.extras && Object.keys(dto.extras).length
            ? { extras: dto.extras as unknown as Prisma.InputJsonValue }
            : {}),
          ...(dto.guestCleaners
            ? {
                guestCleaners:
                  dto.guestCleaners as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(additional !== null
            ? { additionalServices: additional as unknown as Prisma.InputJsonValue }
            : {}),
          isLarge: (finalPrice || estimatedPrice) >= LARGE_ORDER_THRESHOLD,
          // ТЗ 3.1 — команда назначается сразу при оформлении
          ...(cleanerIds.length
            ? { cleaners: { connect: cleanerIds.map((id) => ({ id })) } }
            : {}),
        },
        include: orderDetailInclude,
      });

      await tx.client.update({
        where: { id: dto.clientId },
        data: { lastContactAt: new Date() },
      });

      await this.audit.log(tx, {
        user,
        entity: 'ORDER',
        entityId: created.id,
        entityTitle: this.titleOf(created),
        action: AuditAction.CREATE,
        summary: `Создан заказ на ${finalPrice || estimatedPrice} сомони`,
      });

      return created;
    });

    await this.notifyPreferences(order, 'создан');
    // пожелания и комментарий из новой заявки запоминаем в карточке клиента
    await this.rememberPreferences(order.clientId, order.preferences);
    await this.rememberComment(order.clientId, order.comment);
    return order;
  }

  async update(user: AuthUser, id: string, dto: UpdateOrderDto) {
    const before = await this.getOne(user, id);

    const data: Prisma.OrderUncheckedUpdateInput = {};
    const assignable: (keyof UpdateOrderDto)[] = [
      'cleaningType',
      'serviceKey',
      'dirtLevel',
      'area',
      'seats',
      'address',
      'estimatedPrice',
      'preferences',
      'comment',
      'accessMethod',
      'hasUtilities',
      // ТЗ: данные заявки правятся вручную — заявка могла прийти с опечаткой
      'source',
      'preferredTime',
    ];
    for (const key of assignable) {
      if (dto[key] !== undefined) (data as any)[key] = dto[key];
    }

    // у мойки мебели нет степени загрязнения
    const cleaningType = (data.cleaningType as any) ?? before.cleaningType;
    if (cleaningType === 'FURNITURE') data.dirtLevel = null;

    // ключ услуги следует за видом уборки, если явно не задан
    if (dto.serviceKey === undefined && dto.cleaningType !== undefined) {
      data.serviceKey = dto.cleaningType;
    }

    // Даты: кривая строка из формы не должна превращаться в Invalid Date
    if (dto.inspectionDate !== undefined) {
      data.inspectionDate = parseDate(dto.inspectionDate);
    }
    if (dto.scheduledDate !== undefined) {
      data.scheduledDate = parseDate(dto.scheduledDate);
    }
    if (dto.preferredDate !== undefined) {
      data.preferredDate = parseDate(dto.preferredDate);
    }
    /*
     * Дату оформления тоже разрешаем править: заявку могли занести в CRM
     * позже, чем она реально поступила, и тогда отчёты за период врут.
     * Пустое значение игнорируем — заказ без даты создания недопустим.
     */
    if (dto.createdAt) {
      const created = parseDate(dto.createdAt);
      if (created) data.createdAt = created;
    }
    if (dto.managerId && seesAll(user)) data.managerId = dto.managerId;

    // ── Пересчёт суммы (ТЗ 5) ──
    const serviceKey =
      (data.serviceKey as string) ?? before.serviceKey ?? before.cleaningType;
    const [tariff, extrasList] = await Promise.all([
      this.tariffFor(serviceKey),
      this.extrasCatalogue(),
    ]);
    const nextExtras =
      dto.extras !== undefined
        ? dto.extras
        : ((before.extras as Record<string, number> | null) ?? undefined);
    const nextDiscount = dto.discount !== undefined ? dto.discount : before.discount;
    /*
     * Дополнительные услуги: новые строки обогащаем заново (цены могли
     * поправить руками), нетронутые берём из заказа как есть — их снапшоты
     * не пересчитываются от правок справочника.
     */
    /*
     * Степень загрязнения после правки.
     *
     * Через `??` её брать нельзя: у мойки мягкой мебели data.dirtLevel
     * намеренно выставлен в null, а `null ?? before.dirtLevel` вернул бы
     * СТАРУЮ степень — и дополнительные услуги посчитались бы по цене,
     * которой в этом заказе уже нет.
     */
    const nextDirt = ('dirtLevel' in data
      ? (data.dirtLevel as DirtLevel | null)
      : before.dirtLevel) as DirtLevel | null;

    /*
     * Цена за единицу.
     *
     * Сохранённое в заказе значение — это ВЫВОД прошлого расчёта, а не решение
     * человека: его пишет сама автоматика после каждого пересчёта. Подставлять
     * его обратно как «заданную вручную» цену допустимо, только пока основание
     * расчёта не менялось. Если поменяли услугу или степень загрязнения, цена
     * обязана последовать за справочником — иначе переключение с «лёгкой» на
     * «тяжёлую» не меняло сумму вообще.
     *
     * Явно присланная цена (менеджер вписал её в поле) по-прежнему главнее всего.
     */
    const pricingBasisChanged =
      dto.serviceKey !== undefined ||
      dto.cleaningType !== undefined ||
      dto.dirtLevel !== undefined;
    const unitOverride =
      dto.pricePerSqm !== undefined
        ? dto.pricePerSqm
        : pricingBasisChanged
          ? null
          : before.pricePerSqm;
    const additional =
      dto.additionalServices !== undefined
        ? await this.enrichAdditional(dto.additionalServices, nextDirt)
        : ((before.additionalServices as
            | { total: number }[]
            | null) ?? null);
    const additionalWork = (additional ?? []).reduce(
      (sum, r) => sum + (Number(r.total) || 0),
      0,
    );
    const priced = calculatePrice(
      {
        serviceKey,
        area: (data.area as number) ?? before.area,
        seats: (data.seats as number) ?? before.seats,
        dirtLevel: nextDirt,
        pricePerSqm: unitOverride,
        extras: nextExtras,
        discount: nextDiscount,
        additionalWork,
      },
      tariff,
      extrasList,
    );
    if (dto.extras !== undefined) data.extras = dto.extras;
    if (dto.discount !== undefined) data.discount = dto.discount;
    /*
     * Сумма оплаты сюда больше не приходит: с появлением взносов (ТЗ 3.1)
     * она считается из них — POST /orders/:id/payments. Прямая запись поля
     * развела бы карточку с книгой доходов: деньги в заказе были бы, а
     * канала и строки дохода — нет.
     */
    if (dto.guestCleaners !== undefined) {
      data.guestCleaners =
        dto.guestCleaners as unknown as Prisma.InputJsonValue;
    }
    if (dto.additionalServices !== undefined) {
      data.additionalServices = (additional ??
        []) as unknown as Prisma.InputJsonValue;
    }
    if (dto.sourceDetail !== undefined) {
      data.sourceDetail = dto.sourceDetail.trim() || null;
    }
    if (dto.pricePerSqm !== undefined || priced.pricePerUnit) {
      data.pricePerSqm = priced.pricePerUnit || null;
    }

    // Ручной итог остаётся ручным, пока менеджер сам не вернёт автоматический
    const manualNow =
      dto.isManualPrice !== undefined ? dto.isManualPrice : before.isManualPrice;
    if (dto.finalPrice !== undefined) {
      data.finalPrice = dto.finalPrice;
      data.isManualPrice =
        dto.isManualPrice !== undefined
          ? dto.isManualPrice
          : dto.finalPrice !== priced.total;
    } else if (!manualNow) {
      data.finalPrice = priced.total || null;
      data.isManualPrice = false;
    } else if (dto.isManualPrice === false) {
      // менеджер вернул автоматический расчёт
      data.finalPrice = priced.total || null;
      data.isManualPrice = false;
    }

    /*
     * «Крупность» считаем по ИТОГОВОМУ состоянию заказа, а не по полям текущего
     * запроса: раньше правка одного адреса сбрасывала признак, потому что цена
     * в теле запроса отсутствовала.
     */
    const effectivePrice =
      (data.finalPrice as number | null | undefined) ??
      before.finalPrice ??
      (data.estimatedPrice as number | undefined) ??
      before.estimatedPrice ??
      0;
    data.isLarge = effectivePrice >= LARGE_ORDER_THRESHOLD;

    /*
     * У закрытого заказа сумма не может разойтись с оплатой.
     *
     * «Оплачено» означает ровно одно: клиент рассчитался полностью. Стоит
     * поменять цену уже закрытого заказа — и это перестаёт быть правдой:
     * подняли цену — образовался долг у сделки, которая числится закрытой;
     * опустили — клиент оказывается переплатившим, а переплату система не
     * принимает даже при внесении денег.
     *
     * Раньше расхождение подтягивалось автоматически: доход в книге просто
     * переписывался под новую сумму заказа. С появлением взносов так делать
     * нельзя — в книге лежат реально полученные деньги по каналам, и
     * переписывать их «под цену» значит выдумывать поступления.
     *
     * Поэтому цену закрытого заказа меняют так: руководитель возвращает его
     * в работу, правит и снова закрывает — с тем же контролем, что и всегда.
     */
    if (before.stage === FunnelStage.PAID) {
      const paid = before.paidAmount ?? 0;
      if (effectivePrice !== paid) {
        throw new BadRequestException(
          `Заказ закрыт и оплачен на ${paid} сомони — новая сумма ${effectivePrice} с ней не сходится. ` +
            'Верните заказ в работу, измените сумму и закройте снова',
        );
      }
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data,
        include: orderDetailInclude,
      });

      /*
       * Заказ уже оплачен — доход в книге обязан следовать за его суммой.
       *
       * Раньше доход записывался только в момент перехода в «Оплачено».
       * Стоило потом уточнить сумму — например, после осмотра, — и книга
       * доходов расходилась с воронкой и аналитикой навсегда: три экрана
       * показывали три разных числа, и сойтись они уже не могли.
       *
       * recordOrderIncome идемпотентен по autoKey и не трогает записи,
       * которые руководитель правил вручную.
       */
      if (updated.stage === FunnelStage.PAID) {
        await this.finance.recordOrderIncome(
          tx,
          {
            id: updated.id,
            clientId: updated.clientId,
            finalPrice: updated.finalPrice,
            estimatedPrice: updated.estimatedPrice,
            closedAt: updated.closedAt,
          },
          user,
        );
      }

      await this.audit.log(tx, {
        user,
        entity: 'ORDER',
        entityId: updated.id,
        entityTitle: this.titleOf(updated),
        action: AuditAction.UPDATE,
        changes: this.audit.diff(before as any, updated as any, [
          'cleaningType',
          'serviceKey',
          'dirtLevel',
          'area',
          'seats',
          'address',
          'estimatedPrice',
          'pricePerSqm',
          'finalPrice',
          'isManualPrice',
          'preferences',
          'comment',
          'managerId',
          'scheduledDate',
          'inspectionDate',
        ]),
      });

      return updated;
    });

    // уведомляем, только если предпочтения действительно поменялись —
    // иначе чат завалит сообщениями при каждой правке адреса
    if (
      dto.preferences !== undefined &&
      (before.preferences ?? '') !== (after.preferences ?? '')
    ) {
      await this.notifyPreferences(after, 'изменён');
      await this.rememberPreferences(after.clientId, after.preferences);
    }

    // комментарий клиента — в заметки карточки, если его меняли
    if (
      dto.comment !== undefined &&
      (before.comment ?? '') !== (after.comment ?? '')
    ) {
      await this.rememberComment(after.clientId, after.comment);
    }

    return after;
  }

  /**
   * Пожелания из заказа запоминаются в карточке клиента.
   *
   * Менеджер записывает их в заказе — «есть кот», «обувь снимать», — а при
   * следующей уборке всё выяснялось заново: поле у клиента оставалось
   * пустым, и связи между двумя полями не было никакой.
   *
   * Дописываем новой строкой, а не заменяем: у постоянного клиента в
   * карточке уже могут быть пожелания, и свежий заказ не должен их стирать.
   * Повтор одного и того же текста не добавляем — иначе после третьей
   * уборки в карточке лежала бы одна фраза трижды.
   */
  private rememberPreferences(clientId: string, text: string | null) {
    return this.appendToClient(clientId, 'preferences', text);
  }

  /**
   * Комментарий клиента из заказа запоминается в заметках карточки.
   *
   * «Есть кот», «домофон не работает» — сказанное при обращении жило только
   * внутри одного заказа: при следующей уборке всё выяснялось заново.
   * Кладём именно в заметки, а не в предпочтения: предпочтения показываются
   * менеджеру при оформлении КАЖДОГО заказа, и разовые фразы вроде «сегодня
   * буду после трёх» там только мешали бы (решение владельца).
   */
  private rememberComment(clientId: string, text: string | null) {
    return this.appendToClient(clientId, 'notes', text);
  }

  /**
   * Дописать строку в текстовое поле карточки клиента.
   *
   * Именно дописать, а не заменить: у постоянного клиента там уже может быть
   * записанное раньше, и свежий заказ не должен его стирать. Повтор одной и
   * той же фразы не добавляем — иначе после третьей уборки она лежала бы
   * трижды.
   */
  private async appendToClient(
    clientId: string,
    field: 'preferences' | 'notes',
    text: string | null,
  ): Promise<void> {
    const fresh = text?.trim();
    if (!fresh) return;
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { preferences: true, notes: true },
    });
    const saved = (client?.[field] ?? '').trim();
    if (saved === fresh) return;
    if (saved.split('\n').some((line) => line.trim() === fresh)) return;
    const next = saved ? `${saved}\n${fresh}` : fresh;
    await this.prisma.client.update({
      where: { id: clientId },
      data: { [field]: next.slice(0, 2000) },
    });
  }

  /** Перевод по воронке + побочные эффекты */
  async changeStage(user: AuthUser, id: string, dto: ChangeStageDto) {
    const order = await this.getOne(user, id);

    if (dto.stage === FunnelStage.REJECTED && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('Укажите причину отказа');
    }

    /*
     * «Оплачено / Закрыто» — только после полного расчёта с клиентом.
     * Проверка стоит именно здесь, а не только в браузере: закрытый заказ
     * уходит из воронки, попадает в выручку и порождает ведомость, поэтому
     * недоплата не должна проскакивать ни перетаскиванием, ни прямым
     * запросом к серверу.
     */
    /*
     * Возврат из «Оплачено» в «К оплате» запрещён: заказ, за который клиент
     * полностью рассчитался, снова оказывался в долгах этапа. Тот же запрет
     * стоит в воронке — здесь он на случай прямого запроса к серверу.
     */
    /*
     * Оплаченный заказ с этапа не двигается (решение владельца).
     *
     * Раньше запрет стоял на одном переходе — «Оплачено» → «К оплате», — а
     * во все остальные колонки карточку можно было утащить мышью: закрытая
     * сделка с уже записанным доходом уезжала обратно «в работу».
     *
     * Исключение одно: руководитель может вернуть заказ, если оплату отметили
     * по ошибке. Делается это в карточке заказа — в воронке карточка не
     * берётся вовсе, поэтому случайным движением руки сделку не откроешь.
     * Доход при возврате снимается автоматически (см. removeOrderIncome ниже),
     * так что книга доходов остаётся согласованной с воронкой.
     */
    if (order.stage === FunnelStage.PAID && dto.stage !== FunnelStage.PAID) {
      if (!seesFinance(user)) {
        throw new ForbiddenException(
          'Заказ оплачен и закрыт. Вернуть его в работу может только руководитель — из карточки заказа',
        );
      }
    }

    if (dto.stage === FunnelStage.PAID) {
      const total = order.finalPrice ?? order.estimatedPrice ?? 0;
      const due = Math.max(0, total - (order.paidAmount ?? 0));
      if (due > 0) {
        throw new BadRequestException(
          `Нельзя закрыть заказ: клиент должен ${due} из ${total} сомони. ` +
            'Внесите оплату в карточке заказа.',
        );
      }
    }

    const data: Prisma.OrderUncheckedUpdateInput = { stage: dto.stage };
    if (dto.stage === FunnelStage.REJECTED) {
      data.rejectionReason = dto.rejectionReason;
      data.closedAt = new Date();
    } else if (order.stage === FunnelStage.REJECTED) {
      // возврат из «Отказа» на активный этап — чистим причину и дату закрытия
      data.rejectionReason = null;
      data.closedAt = null;
    }
    if (dto.stage === FunnelStage.PAID) data.closedAt = new Date();
    // ушли из «Оплачено» — дата закрытия больше не действительна,
    // иначе заказ продолжит числиться в выручке периода
    if (order.stage === FunnelStage.PAID && dto.stage !== FunnelStage.PAID) {
      data.closedAt = null;
    }
    if (dto.scheduledDate !== undefined) {
      data.scheduledDate = parseDate(dto.scheduledDate);
    }

    let draftReport: { id: string } | null = null;
    let autoVisit: { id: string } | null = null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.update({
        where: { id },
        data,
        include: orderDetailInclude,
      });

      await tx.client.update({
        where: { id: order.clientId },
        data: { lastContactAt: new Date() },
      });

      /*
       * Доход компании фиксируется автоматически при переходе в «Оплачено»
       * (ТЗ 7.1) и снимается, если заказ из этого этапа вышел. Делаем это
       * в той же транзакции: иначе при сбое книга доходов разойдётся с воронкой.
       */
      if (dto.stage === FunnelStage.PAID) {
        await this.finance.recordOrderIncome(
          tx,
          {
            id: res.id,
            clientId: res.clientId,
            finalPrice: res.finalPrice,
            estimatedPrice: res.estimatedPrice,
            closedAt: res.closedAt,
          },
          user,
        );
      } else if (order.stage === FunnelStage.PAID) {
        await this.finance.removeOrderIncome(tx, res.id, user);
      }

      /*
       * Черновик платёжной ведомости по оплаченному заказу.
       * Заполняется данными самого заказа — клиент, адрес, объём, сумма,
       * ответственный менеджер и назначенная команда, — чтобы менеджеру
       * осталось только нажать «Отправить основателю».
       * Повторный перевод в «Оплачено» второй ведомости не создаёт.
       */
      if (dto.stage === FunnelStage.PAID) {
        draftReport = await this.reports.createFromOrder(tx, res.id, user.id);
      }

      /*
       * Осмотр объекта — это выезд на объект, поэтому он сразу появляется в
       * «Сменах и выездах» с адресом, датой, составом команды и менеджером.
       * Раньше менеджер заводил его руками, повторно вбивая то, что уже есть
       * в заказе. Повторный заход на этап второй выезд не создаёт.
       */
      if (dto.stage === FunnelStage.INSPECTION) {
        autoVisit = await this.shiftGroups.createFromOrder(tx, res.id, user.id);
      }

      await this.audit.log(tx, {
        user,
        entity: 'ORDER',
        entityId: res.id,
        entityTitle: this.titleOf(res),
        action: AuditAction.STAGE_CHANGE,
        summary: `${STAGE_LABEL[order.stage]} → ${STAGE_LABEL[dto.stage]}`,
        ...(dto.rejectionReason
          ? { changes: [{ field: 'rejectionReason', label: 'Причина отказа', before: null, after: dto.rejectionReason }] }
          : {}),
      });

      return res;
    });

    // авто-теги клиента и метка «повторный» (ТЗ 9.4)
    if (dto.stage === FunnelStage.REJECTED) {
      await this.addClientTag(order.clientId, ClientTag.REFUSED);
    }
    if (dto.stage === FunnelStage.PAID || order.stage === FunnelStage.PAID) {
      await this.refreshClientRepeat(order.clientId);
    }

    /*
     * Сообщаем ответственному, что ведомость уже готова к отправке.
     * Вне транзакции: сбой уведомления не должен откатывать смену этапа.
     */
    if (draftReport) {
      const target = updated.managerId ?? user.id;
      await this.notifications.notify({
        userId: target,
        type: NotificationType.REPORT_DRAFT_READY,
        title: 'Готов черновик платёжной ведомости',
        message: `${updated.client.fullName} · ${updated.finalPrice ?? updated.estimatedPrice} сомони — проверьте и отправьте основателю`,
        orderId: updated.id,
      });
    }

    /*
     * Выезд создан сам — говорим об этом ответственному. Иначе автоматика
     * незаметна: человек не знает, что в «Сменах» уже есть запись, и заводит
     * вторую руками.
     */
    if (autoVisit) {
      await this.notifications.notify({
        userId: updated.managerId ?? user.id,
        type: NotificationType.VISIT_PLANNED,
        title: 'Выезд на осмотр добавлен в «Смены»',
        message: `${updated.client.fullName} · ${
          updated.address?.trim() || 'адрес не указан'
        } — проверьте дату, время и состав команды`,
        orderId: updated.id,
      });
    }

    // уведомление руководителю о смене статуса крупного заказа
    if (updated.isLarge) {
      await this.notifications.notifyDirectors({
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'Статус крупного заказа изменён',
        message: `Заказ ${updated.client.fullName} → «${STAGE_LABEL[dto.stage]}» (${updated.finalPrice ?? updated.estimatedPrice} сомони)`,
        orderId: updated.id,
      });
    }

    return updated;
  }

  async assignCleaners(user: AuthUser, id: string, dto: AssignCleanersDto) {
    const before = await this.getOne(user, id);
    const cleanerIds = await this.resolveCleaners(dto.cleanerIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.update({
        where: { id },
        data: { cleaners: { set: cleanerIds.map((cid) => ({ id: cid })) } },
        include: orderDetailInclude,
      });

      const wasNames = before.cleaners.map((c) => c.fullName).join(', ') || '—';
      const nowNames = res.cleaners.map((c) => c.fullName).join(', ') || '—';
      if (wasNames !== nowNames) {
        await this.audit.log(tx, {
          user,
          entity: 'ORDER',
          entityId: res.id,
          entityTitle: this.titleOf(res),
          action: AuditAction.UPDATE,
          summary: `Команда на заказе: ${wasNames} → ${nowNames}`,
        });
      }
      return res;
    });

    return updated;
  }

  /** Удаление переносит заказ в корзину (ТЗ 6) */
  async remove(user: AuthUser, id: string, reason?: string) {
    const order = await this.getOne(user, id); // проверка доступа

    await this.prisma.$transaction(async (tx) => {
      const stamp = softDeleteData(user, reason);
      await tx.order.update({ where: { id }, data: stamp });

      // дети уходят в корзину тем же штампом времени — по нему при
      // восстановлении будет видно, что удалялось вместе с заказом
      await tx.proposal.updateMany({
        where: { orderId: id, ...NOT_DELETED },
        data: stamp,
      });
      await tx.reminder.updateMany({
        where: { orderId: id, ...NOT_DELETED },
        data: stamp,
      });

      /*
       * Уведомления по заказу убираем: переходить по ним больше некуда, а
       * экран на месте удалённого заказа показывал «Проверьте интернет».
       */
      await tx.notification.deleteMany({ where: { orderId: id } });
      /*
       * Доход по заказу уходит в корзину вместе с ним.
       *
       * Иначе удалённый оплаченный заказ пропадал из воронки и аналитики
       * (там всюду фильтр по корзине), но продолжал числиться в книге
       * доходов — прибыль компании оказывалась завышенной на его сумму,
       * и найти причину по экранам было невозможно.
       *
       * Штамп тот же, что у заказа: при восстановлении из корзины запись
       * вернётся вместе с ним (см. cascade в trash.registry).
       */
      await tx.financeEntry.updateMany({
        where: { orderId: id, ...NOT_DELETED },
        data: stamp,
      });

      await this.audit.log(tx, {
        user,
        entity: 'ORDER',
        entityId: id,
        entityTitle: this.titleOf(order),
        action: AuditAction.DELETE,
        summary: reason ? `Перенесён в корзину: ${reason}` : 'Перенесён в корзину',
      });
    });

    return { ok: true };
  }

  /** История изменений заказа (ТЗ 2) */
  async history(user: AuthUser, id: string) {
    await this.getOne(user, id); // проверка доступа
    return this.audit.forEntity('ORDER', id);
  }

  /**
   * Уведомление в Telegram о заказе с учётом предпочтений клиента (ТЗ 10.2).
   *
   * Шлём в общий рабочий чат: предпочтения нужны бригаде ДО выезда, а не только
   * менеджеру. Отправка идёт через очередь, поэтому недоступность Telegram
   * не мешает сохранить заказ.
   */
  private async notifyPreferences(
    order: {
      id: string;
      address?: string | null;
      preferences?: string | null;
      scheduledDate?: Date | null;
      client?: { fullName?: string; phone?: string; preferences?: string | null } | null;
    },
    action: 'создан' | 'изменён',
  ) {
    const own = order.preferences?.trim();
    const clientWide = order.client?.preferences?.trim();
    const text = [own, clientWide].filter(Boolean).join('; ');
    if (!text) return; // предпочтений нет — уведомлять не о чем

    const lines = [
      `<b>Заказ ${action}: учтены предпочтения клиента</b>`,
      `Клиент: ${escapeHtml(order.client?.fullName ?? '—')}`,
      order.client?.phone ? `Телефон: ${escapeHtml(order.client.phone)}` : null,
      order.address ? `Адрес: ${escapeHtml(order.address)}` : null,
      order.scheduledDate
        ? `Дата уборки: ${formatDate(order.scheduledDate)}`
        : null,
      `Предпочтения: ${escapeHtml(text)}`,
    ].filter(Boolean);

    await this.telegram.enqueueToCompanyChat(lines.join('\n'), {
      kind: 'order_preferences',
      refId: order.id,
    });

    await this.notifications.notifyDirectors({
      type: NotificationType.ORDER_PREFERENCES,
      title: 'Заказ с предпочтениями клиента',
      message: `${order.client?.fullName ?? 'Клиент'} · ${text.slice(0, 160)}`,
      orderId: order.id,
    });
  }

  /**
   * Автостатус клиента («Отказник» при отказе, «Постоянный» после повторных
   * оплат). Статус у клиента ОДИН, и автоматика не смеет перетирать ручной:
   * VIP и «Потенциальный» ставит человек — если они стоят, событие ничего
   * не меняет. Автоматический статус другим автоматическим заменяется.
   */
  private async addClientTag(clientId: string, tag: ClientTag) {
    const MANUAL: ClientTag[] = [ClientTag.VIP, ClientTag.POTENTIAL];
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { tags: true },
    });
    if (!client) return;
    if (client.tags.some((t) => MANUAL.includes(t))) return;
    if (client.tags.length === 1 && client.tags[0] === tag) return;
    await this.prisma.client.update({
      where: { id: clientId },
      data: { tags: { set: [tag] } },
    });
  }

  /**
   * Пересчёт признака «повторный клиент» (ТЗ 9.4).
   * Считаем по факту оплаченных заказов, а не наращиваем счётчик:
   * так значение остаётся верным и при откате этапа, и при удалении заказа.
   */
  private async refreshClientRepeat(clientId: string) {
    const paid = await this.prisma.order.findMany({
      where: { clientId, stage: FunnelStage.PAID, ...NOT_DELETED },
      select: { closedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const count = paid.length;
    const last = paid[0]?.closedAt ?? paid[0]?.createdAt ?? null;

    await this.prisma.client.update({
      where: { id: clientId },
      data: {
        paidOrdersCount: count,
        isRepeat: count >= 2,
        lastOrderAt: last,
      },
    });
    if (count >= 2) await this.addClientTag(clientId, ClientTag.REGULAR);
  }
}
