import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, FunnelStage, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanceService } from '../finance/finance.service';
import { AuthUser, seesAll } from '../common/decorators/current-user.decorator';
import { seesFinance } from '../common/permissions';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { parseDate } from '../common/time/dushanbe';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';

/**
 * Что видно о взносе снаружи.
 *
 * Именно select, а не include: наружу не должны уезжать служебные поля
 * (кто удалил, причина, отметки корзины) — карточка заказа отдаёт ровно
 * тот же набор.
 */
const paymentSelect = {
  id: true,
  orderId: true,
  amount: true,
  method: true,
  bankId: true,
  note: true,
  paidAt: true,
  createdByName: true,
  bank: { select: { id: true, title: true } },
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Наличные',
  BANK: 'Безналичный расчёт',
};

/** Взнос в том виде, в каком он уходит на экран и в книгу доходов */
type PaymentRow = {
  id: string;
  orderId: string;
  amount: number;
  method: PaymentMethod | null;
  bankId: string | null;
  note: string | null;
  paidAt: Date;
  createdByName: string | null;
  bank: { id: string; title: string } | null;
};

/**
 * Оплаты по заказу (ТЗ 3.1 и 3.2).
 *
 * Почему отдельный сервис, а не пара полей в заказе: система должна знать не
 * только СКОЛЬКО получено, но и чем, когда и сколькими частями. Смешанная
 * оплата из ТЗ 3.2 — это не особый вид платежа, а несколько взносов разными
 * способами, внесённых одним действием; поэтому отдельной сущности «смешанная
 * оплата» здесь нет, есть список взносов.
 *
 * Поле Order.paidAmount осталось: на него завязаны долг в карточке, сумма
 * этапа в воронке и аналитика. Оно пересчитывается из взносов при каждом
 * изменении — расходиться им нельзя.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private finance: FinanceService,
  ) {}

  /** Итог заказа, от которого считаются остаток и переплата */
  private orderTotal(order: {
    finalPrice: number | null;
    estimatedPrice: number;
  }): number {
    return order.finalPrice ?? order.estimatedPrice ?? 0;
  }

  /**
   * Заказ вместе с его взносами — и проверка, что он вообще доступен этому
   * сотруднику. Менеджер работает только со своими заказами: без этой
   * проверки по прямому запросу можно было бы вносить оплату в чужой.
   */
  private async loadOrder(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...NOT_DELETED },
      select: {
        id: true,
        clientId: true,
        managerId: true,
        stage: true,
        finalPrice: true,
        estimatedPrice: true,
        paidAmount: true,
        payments: {
          where: NOT_DELETED,
          orderBy: { paidAt: 'asc' },
          select: paymentSelect,
        },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (!seesAll(user) && order.managerId !== user.id) {
      throw new NotFoundException('Заказ не найден');
    }
    return order;
  }

  /**
   * Оплаченный заказ трогает только руководитель.
   *
   * Иначе запрет «увести заказ из „Оплачено“ может только руководитель»
   * (orders.service.changeStage) обходится с другой стороны: менеджер удаляет
   * свой же взнос, сумма оплаты падает ниже итога, а заказ остаётся закрытым.
   * Сделка молча превращается в недоплаченную, и никто об этом не узнаёт.
   */
  private assertCanTouch(user: AuthUser, order: { stage: FunnelStage }) {
    if (order.stage === FunnelStage.PAID && !seesFinance(user)) {
      throw new ForbiddenException(
        'Заказ оплачен и закрыт. Изменить оплату может только руководитель',
      );
    }
  }

  /** Список взносов по заказу */
  async list(user: AuthUser, orderId: string) {
    const order = await this.loadOrder(user, orderId);
    return order.payments;
  }

  /**
   * Пересчёт суммы оплаты заказа из взносов.
   *
   * Единственное место, где меняется Order.paidAmount после появления
   * платежей: любое другое присвоение снова развело бы карточку и книгу
   * доходов. Возвращает новую сумму.
   */
  private async recalc(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<number> {
    const agg = await tx.orderPayment.aggregate({
      where: { orderId, ...NOT_DELETED },
      _sum: { amount: true },
    });
    const paid = agg._sum.amount ?? 0;
    await tx.order.update({ where: { id: orderId }, data: { paidAmount: paid } });
    return paid;
  }

  /**
   * Заказ под замком до конца транзакции.
   *
   * Без этого проверка «не переплатили ли» была бы гаданием: два запроса,
   * пришедшие одновременно (двойное нажатие, две вкладки, повтор после
   * таймаута), читали одну и ту же сумму «уже внесено», оба признавали её
   * допустимой и оба записывались. По заказу на 10 000 сомони так проходили
   * два взноса по 10 000 — и в кассе, и в книге доходов.
   *
   * Блокировка строки заказа выстраивает такие запросы в очередь: второй
   * увидит уже записанный взнос первого и получит честный отказ.
   */
  private async lockOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<{ total: number; already: number }> {
    const rows = await tx.$queryRaw<
      { finalPrice: number | null; estimatedPrice: number }[]
    >`SELECT "finalPrice", "estimatedPrice" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new NotFoundException('Заказ не найден');

    const agg = await tx.orderPayment.aggregate({
      where: { orderId, ...NOT_DELETED },
      _sum: { amount: true },
    });
    return {
      total: this.orderTotal(row),
      already: agg._sum.amount ?? 0,
    };
  }

  /** Банк должен существовать и быть действующим — иначе ссылка в никуда */
  private async resolveBank(bankId: string | undefined | null) {
    if (!bankId) return null;
    const bank = await this.prisma.paymentBank.findFirst({
      where: { id: bankId, ...NOT_DELETED },
      select: { id: true, title: true, isActive: true },
    });
    if (!bank) throw new BadRequestException('Банк не найден');
    if (!bank.isActive) {
      throw new BadRequestException(
        `Банк «${bank.title}» отключён — выберите другой или включите его в справочнике`,
      );
    }
    return bank;
  }

  /**
   * Внесение оплаты: одна часть или сразу несколько (смешанная оплата).
   *
   * Проверки ровно те, что требует ТЗ 3.2:
   *   • сумма частей строго равна заявленной сумме платежа — иначе отказ;
   *   • безналичный расчёт без банка не принимается;
   *   • переплата по заказу не принимается: деньги, которых клиент не должен,
   *     попали бы в доход и исказили выручку.
   */
  async create(user: AuthUser, orderId: string, dto: CreatePaymentDto) {
    const order = await this.loadOrder(user, orderId);
    this.assertCanTouch(user, order);
    if (this.orderTotal(order) <= 0) {
      throw new BadRequestException(
        'У заказа не задана сумма — сначала посчитайте стоимость, потом вносите оплату',
      );
    }

    const partsSum = dto.parts.reduce((sum, p) => sum + p.amount, 0);
    if (dto.expectedTotal !== undefined && dto.expectedTotal !== partsSum) {
      throw new BadRequestException(
        `Сумма частей ${partsSum} не совпадает с суммой платежа ${dto.expectedTotal} сомони. ` +
          'Исправьте разбивку — оплата не проведена',
      );
    }

    for (const part of dto.parts) {
      if (part.method === PaymentMethod.BANK && !part.bankId) {
        throw new BadRequestException(
          'При безналичном расчёте укажите банк: Алиф, Душанбе Сити или другой',
        );
      }
      if (part.method === PaymentMethod.CASH && part.bankId) {
        throw new BadRequestException('У наличной оплаты банка быть не может');
      }
      await this.resolveBank(part.bankId);
    }

    const paidAt = dto.paidAt ? (parseDate(dto.paidAt) ?? new Date()) : new Date();

    return this.prisma.$transaction(async (tx) => {
      // проверка переплаты — под замком заказа, см. lockOrder
      const { total, already } = await this.lockOrder(tx, orderId);
      if (already + partsSum > total) {
        const left = Math.max(0, total - already);
        throw new BadRequestException(
          `Переплата: по заказу осталось внести ${left} из ${total} сомони, а вносится ${partsSum}`,
        );
      }

      const created: PaymentRow[] = [];
      for (const part of dto.parts) {
        const payment = (await tx.orderPayment.create({
          data: {
            orderId,
            amount: part.amount,
            method: part.method,
            bankId: part.bankId ?? null,
            note: part.note?.trim() || null,
            paidAt,
            createdById: user.id,
            createdByName: user.fullName,
          },
          select: paymentSelect,
        })) as PaymentRow;
        created.push(payment);

        /*
         * Доход признаётся в момент получения денег, а не при закрытии
         * заказа. Так предоплата видна в книге доходов сразу, а смешанная
         * оплата разделяется по каналам — это и есть требование ТЗ 3.2.
         */
        await this.finance.recordPaymentIncome(tx, payment, order.clientId, user);
      }

      const paid = await this.recalc(tx, orderId);

      await this.audit.log(tx, {
        user,
        entity: 'ORDER',
        entityId: orderId,
        entityTitle: `Заказ — оплата`,
        action: AuditAction.UPDATE,
        summary:
          created.length > 1
            ? `Смешанная оплата ${partsSum} сомони (${created
                .map((p) => `${p.amount} — ${this.channelName(p)}`)
                .join(', ')})`
            : `Оплата ${partsSum} сомони — ${this.channelName(created[0])}`,
      });

      return { payments: created, paidAmount: paid, total };
    });
  }

  /** Как назвать канал в журнале и в книге доходов */
  private channelName(payment: {
    method: PaymentMethod | null;
    bank?: { title: string } | null;
  }): string {
    if (!payment.method) return 'способ не указан';
    if (payment.method === PaymentMethod.CASH) return METHOD_LABEL.CASH;
    return payment.bank?.title ?? METHOD_LABEL.BANK;
  }

  async update(
    user: AuthUser,
    orderId: string,
    paymentId: string,
    dto: UpdatePaymentDto,
  ) {
    const order = await this.loadOrder(user, orderId);
    this.assertCanTouch(user, order);
    const before = order.payments.find((p) => p.id === paymentId);
    if (!before) throw new NotFoundException('Платёж не найден');

    const nextAmount = dto.amount ?? before.amount;
    const nextMethod = dto.method ?? before.method;
    const nextBankId =
      dto.bankId === undefined ? before.bankId : dto.bankId || null;

    /*
     * У перенесённых из старого учёта взносов способ не указан. Правка такого
     * взноса обязана его назвать: иначе получался платёж «с банком, но без
     * способа» — сводка по банкам его показывала, сводка по безналичному
     * расчёту нет, и два отчёта переставали сходиться.
     */
    if (!nextMethod) {
      throw new BadRequestException(
        'Укажите способ оплаты: наличные или безналичный расчёт',
      );
    }
    if (nextMethod === PaymentMethod.BANK && !nextBankId) {
      throw new BadRequestException('При безналичном расчёте укажите банк');
    }
    if (nextMethod === PaymentMethod.CASH && nextBankId) {
      throw new BadRequestException('У наличной оплаты банка быть не может');
    }
    await this.resolveBank(nextBankId);

    return this.prisma.$transaction(async (tx) => {
      const { total, already } = await this.lockOrder(tx, orderId);
      const others = already - before.amount;
      if (others + nextAmount > total) {
        throw new BadRequestException(
          `Переплата: с этой правкой по заказу выйдет ${others + nextAmount} из ${total} сомони`,
        );
      }

      const updated = (await tx.orderPayment.update({
        where: { id: paymentId },
        data: {
          amount: nextAmount,
          method: nextMethod,
          bankId: nextBankId,
          note: dto.note === undefined ? undefined : dto.note?.trim() || null,
          ...(dto.paidAt ? { paidAt: parseDate(dto.paidAt) ?? undefined } : {}),
        },
        select: paymentSelect,
      })) as PaymentRow;

      await this.finance.recordPaymentIncome(tx, updated, order.clientId, user);
      const paid = await this.recalc(tx, orderId);

      await this.audit.log(tx, {
        user,
        entity: 'ORDER',
        entityId: orderId,
        entityTitle: 'Заказ — оплата',
        action: AuditAction.UPDATE,
        summary: `Платёж изменён: ${before.amount} → ${updated.amount} сомони, ${this.channelName(updated)}`,
      });

      return { payment: updated, paidAmount: paid, total };
    });
  }

  /**
   * Удаление взноса — в корзину, вместе с записью в книге доходов.
   *
   * Деньги «отменяются» не молча: доход снимается тем же движением, иначе
   * касса и книга разошлись бы.
   */
  async remove(user: AuthUser, orderId: string, paymentId: string) {
    const order = await this.loadOrder(user, orderId);
    this.assertCanTouch(user, order);
    const payment = order.payments.find((p) => p.id === paymentId);
    if (!payment) throw new NotFoundException('Платёж не найден');

    return this.prisma.$transaction(async (tx) => {
      await tx.orderPayment.update({
        where: { id: paymentId },
        data: softDeleteData(user, 'Удалён из карточки заказа'),
      });
      await this.finance.removePaymentIncome(tx, paymentId, user);
      const paid = await this.recalc(tx, orderId);

      await this.audit.log(tx, {
        user,
        entity: 'ORDER',
        entityId: orderId,
        entityTitle: 'Заказ — оплата',
        action: AuditAction.UPDATE,
        summary: `Платёж удалён: ${payment.amount} сомони, ${this.channelName(payment)}`,
      });

      return { paidAmount: paid, total: this.orderTotal(order) };
    });
  }
}
