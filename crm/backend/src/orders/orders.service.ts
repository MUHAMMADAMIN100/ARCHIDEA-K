import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ClientTag,
  FunnelStage,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { FinanceService } from '../finance/finance.service';
import { ReportsService } from '../reports/reports.service';
import { TelegramService } from '../telegram/telegram.service';
import { escapeHtml } from '../telegram/telegram.util';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { formatDate, parseDate } from '../common/time/dushanbe';
import { calculatePrice, PricingTariff } from './order-pricing';
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
  DONE: 'Выполнено',
  PAID: 'Оплачено / Закрыто',
  REJECTED: 'Отказ',
};

/** Состав списка воронки — лёгкий, без вложенных выездов */
const orderInclude = {
  client: { select: { id: true, fullName: true, phone: true } },
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
      preferences: true,
      isRepeat: true,
      paidOrdersCount: true,
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
   * Проверяем, что все переданные клинеры существуют,活ны и не в корзине.
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

  list(
    user: AuthUser,
    q: { stage?: FunnelStage; managerId?: string; search?: string },
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
    const stages = Object.keys(STAGE_LABEL) as FunnelStage[];
    return stages.map((stage) => ({
      stage,
      label: STAGE_LABEL[stage],
      orders: orders.filter((o) => o.stage === stage),
    }));
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
    const managerId = seesAll(user) ? dto.managerId ?? null : user.id;
    const cleaningType = dto.cleaningType ?? 'GENERAL';
    const serviceKey = dto.serviceKey?.trim() || cleaningType;
    const dirtLevel = cleaningType === 'FURNITURE' ? null : dto.dirtLevel ?? null;

    // Цену считаем на сервере (ТЗ 5), из браузера её не принимаем
    const tariff = await this.tariffFor(serviceKey);
    const priced = calculatePrice(
      {
        serviceKey,
        area: dto.area,
        seats: dto.seats,
        dirtLevel,
        pricePerSqm: dto.pricePerSqm,
      },
      tariff,
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
    if (dto.managerId && seesAll(user)) data.managerId = dto.managerId;

    // ── Пересчёт суммы (ТЗ 5) ──
    const serviceKey =
      (data.serviceKey as string) ?? before.serviceKey ?? before.cleaningType;
    const tariff = await this.tariffFor(serviceKey);
    const priced = calculatePrice(
      {
        serviceKey,
        area: (data.area as number) ?? before.area,
        seats: (data.seats as number) ?? before.seats,
        dirtLevel: (data.dirtLevel as any) ?? before.dirtLevel,
        pricePerSqm: dto.pricePerSqm ?? before.pricePerSqm,
      },
      tariff,
    );
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

    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data,
        include: orderDetailInclude,
      });

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
    }

    return after;
  }

  /** Перевод по воронке + побочные эффекты */
  async changeStage(user: AuthUser, id: string, dto: ChangeStageDto) {
    const order = await this.getOne(user, id);

    if (dto.stage === FunnelStage.REJECTED && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('Укажите причину отказа');
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

  private async addClientTag(clientId: string, tag: ClientTag) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { tags: true },
    });
    if (client && !client.tags.includes(tag)) {
      await this.prisma.client.update({
        where: { id: clientId },
        data: { tags: { set: [...client.tags, tag] } },
      });
    }
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
