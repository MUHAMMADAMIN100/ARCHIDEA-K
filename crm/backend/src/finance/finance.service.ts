import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  FinanceCategory,
  FinanceKind,
  FinanceSource,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { dayKey, dayUTC, momentRange, startOfDay } from '../common/time/dushanbe';
import { CATEGORY_META, categoryLabel, kindLabel } from './finance.constants';
import {
  CreateFinanceEntryDto,
  FinanceSummaryDto,
  ListFinanceEntryDto,
  UpdateFinanceEntryDto,
} from './dto/finance-entry.dto';

/** Клиент Prisma или транзакция — доход по заказу пишется в той же транзакции, что и его этап */
export type FinanceDb = PrismaService | Prisma.TransactionClient;

/** Минимальный набор полей заказа, нужный для автодохода — без зависимости от orders-модуля */
export interface OrderIncomeSource {
  id: string;
  clientId: string;
  finalPrice?: number | null;
  estimatedPrice?: number | null;
  closedAt?: Date | null;
}

const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;

/**
 * Книга доходов и расходов и связанные с ней автоматические записи (ТЗ 7.1).
 *
 * recordOrderIncome/removeOrderIncome — точка интеграции с другими модулями
 * (заказы, ведомости): им незачем знать про FinanceEntry, они просто вызывают
 * эти методы внутри своей транзакции.
 */
@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private requireView(user: AuthUser): void {
    if (!can(user, 'finance:view')) {
      throw new ForbiddenException('Нет доступа к финансовым разделам');
    }
  }

  private requireManage(user: AuthUser): void {
    if (!can(user, 'finance:manage')) {
      throw new ForbiddenException('Изменять финансовые записи может руководитель или управляющий');
    }
  }

  /** «ГГГГ-ММ-ДД» пользовательского ввода → реальный момент начала этого дня в Душанбе */
  private parseEntryDate(value: string): Date {
    return startOfDay(dayUTC(value));
  }

  private entryTitle(entry: { kind: FinanceKind; title: string; amount: number }): string {
    return `${kindLabel(entry.kind)} — ${entry.title} (${entry.amount} с.)`;
  }

  /** Существование и «не в корзине» — до записи, а не после падения Prisma с P2025/P2003 */
  private async assertOrderExists(orderId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...NOT_DELETED },
      select: { id: true },
    });
    if (!order) throw new BadRequestException('Заказ не найден');
  }

  private async assertClientExists(clientId: string): Promise<void> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, ...NOT_DELETED },
      select: { id: true },
    });
    if (!client) throw new BadRequestException('Клиент не найден');
  }

  private async assertShiftGroupExists(shiftGroupId: string): Promise<void> {
    const group = await this.prisma.shiftGroup.findFirst({
      where: { id: shiftGroupId, ...NOT_DELETED },
      select: { id: true },
    });
    if (!group) throw new BadRequestException('Выезд не найден');
  }

  // ─────────────── ЛЕНТА И СВОДКА ───────────────

  async list(user: AuthUser, q: ListFinanceEntryDto) {
    this.requireView(user);

    const where: Prisma.FinanceEntryWhereInput = { ...NOT_DELETED };
    if (q.kind) where.kind = q.kind;
    if (q.category) where.category = q.category;
    if (q.source) where.source = q.source;
    if (q.orderId) where.orderId = q.orderId;
    // канал поступления: наличные / безнал целиком / конкретный банк (ТЗ 3.1)
    if (q.method) where.paymentMethod = q.method;
    if (q.bankId) where.bankId = q.bankId;
    if (q.from || q.to) where.date = momentRange(q.from, q.to);

    const take = Math.min(q.take ?? DEFAULT_TAKE, MAX_TAKE);
    const skip = q.skip ?? 0;

    const [rows, total, sums] = await Promise.all([
      this.prisma.financeEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take,
        skip,
        // банк — чтобы в списке было видно, каким каналом пришли деньги
        include: { bank: { select: { id: true, title: true } } },
      }),
      this.prisma.financeEntry.count({ where }),
      this.prisma.financeEntry.groupBy({ by: ['kind'], where, _sum: { amount: true } }),
    ]);

    const income = sums.find((s) => s.kind === FinanceKind.INCOME)?._sum.amount ?? 0;
    const expense = sums.find((s) => s.kind === FinanceKind.EXPENSE)?._sum.amount ?? 0;

    return { rows, total, totals: { income, expense, profit: income - expense } };
  }

  /** Сводка за период: итоги, разбивка по статьям, помесячная динамика */
  async summary(user: AuthUser, q: FinanceSummaryDto) {
    this.requireView(user);

    const where: Prisma.FinanceEntryWhereInput = { ...NOT_DELETED };
    if (q.from || q.to) where.date = momentRange(q.from, q.to);

    const entries = await this.prisma.financeEntry.findMany({
      where,
      select: { kind: true, category: true, amount: true, date: true },
    });

    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    const byCategory = new Map<FinanceCategory, number>();
    const byMonth = new Map<string, { income: number; expense: number }>();

    for (const e of entries) {
      if (e.kind === FinanceKind.INCOME) {
        income += e.amount;
        incomeCount += 1;
      } else {
        expense += e.amount;
      }
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);

      const monthKey = dayKey(e.date).slice(0, 7); // 'ГГГГ-ММ' по Душанбе
      const bucket = byMonth.get(monthKey) ?? { income: 0, expense: 0 };
      if (e.kind === FinanceKind.INCOME) bucket.income += e.amount;
      else bucket.expense += e.amount;
      byMonth.set(monthKey, bucket);
    }

    return {
      income,
      expense,
      profit: income - expense,
      avgCheck: incomeCount ? Math.round(income / incomeCount) : 0,
      count: entries.length,
      // kind обязателен: по нему график красит доход зелёным, а расход красным,
      // и по нему же открывается расшифровка статьи
      byCategory: [...byCategory.entries()]
        .map(([category, amount]) => ({
          category,
          label: categoryLabel(category),
          kind: CATEGORY_META[category]?.kind ?? FinanceKind.EXPENSE,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount),
      series: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({ date: month, income: v.income, expense: v.expense })),
    };
  }

  /** Список статей для селектов на форме — из enum, без похода в БД */
  categories(user: AuthUser) {
    this.requireView(user);
    return (Object.keys(CATEGORY_META) as FinanceCategory[]).map((value) => ({
      value,
      label: CATEGORY_META[value].label,
      kind: CATEGORY_META[value].kind,
    }));
  }

  // ─────────────── РУЧНЫЕ ЗАПИСИ ───────────────

  /**
   * Статья расходов однозначно определяет тип записи: «Зарплата» не может быть
   * доходом, «Оплата заказа» — расходом. Без этой проверки можно было создать
   * запись {доход, статья «Зарплата»}: в сводке она попадала и в доходы (по типу),
   * и в расходы по статье — книга переставала сходиться сама с собой.
   */
  private assertKindMatchesCategory(
    kind: FinanceKind,
    category: FinanceCategory,
  ): void {
    const expected = CATEGORY_META[category]?.kind;
    if (expected && expected !== kind) {
      const what = expected === FinanceKind.INCOME ? 'доходом' : 'расходом';
      throw new BadRequestException(
        `Статья «${CATEGORY_META[category].label}» может быть только ${what}`,
      );
    }
  }

  async create(user: AuthUser, dto: CreateFinanceEntryDto) {
    this.requireManage(user);
    this.assertKindMatchesCategory(dto.kind, dto.category);

    if (dto.orderId) await this.assertOrderExists(dto.orderId);
    if (dto.clientId) await this.assertClientExists(dto.clientId);
    if (dto.shiftGroupId) await this.assertShiftGroupExists(dto.shiftGroupId);

    const entry = await this.prisma.financeEntry.create({
      data: {
        kind: dto.kind,
        category: dto.category,
        amount: dto.amount,
        date: this.parseEntryDate(dto.date),
        title: dto.title.trim(),
        comment: dto.comment?.trim() || null,
        source: FinanceSource.MANUAL,
        orderId: dto.orderId || null,
        clientId: dto.clientId || null,
        shiftGroupId: dto.shiftGroupId || null,
        createdById: user.id,
        createdByName: user.fullName,
      },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'FINANCE',
      entityId: entry.id,
      entityTitle: this.entryTitle(entry),
      action: AuditAction.CREATE,
      summary: entry.comment ?? undefined,
    });

    return entry;
  }

  async update(user: AuthUser, id: string, dto: UpdateFinanceEntryDto) {
    this.requireManage(user);

    const before = await this.prisma.financeEntry.findFirst({ where: { id, ...NOT_DELETED } });
    if (!before) throw new NotFoundException('Финансовая запись не найдена');

    if (dto.orderId) await this.assertOrderExists(dto.orderId);
    if (dto.clientId) await this.assertClientExists(dto.clientId);
    if (dto.shiftGroupId) await this.assertShiftGroupExists(dto.shiftGroupId);

    // сверяем ИТОГОВУЮ пару: правка одной только статьи не должна оставить
    // запись в состоянии «доход со статьёй расходов»
    this.assertKindMatchesCategory(
      dto.kind ?? before.kind,
      dto.category ?? before.category,
    );

    const data: Prisma.FinanceEntryUncheckedUpdateInput = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.date !== undefined) data.date = this.parseEntryDate(dto.date);
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.comment !== undefined) data.comment = dto.comment.trim() || null;
    if (dto.orderId !== undefined) data.orderId = dto.orderId || null;
    if (dto.clientId !== undefined) data.clientId = dto.clientId || null;
    if (dto.shiftGroupId !== undefined) data.shiftGroupId = dto.shiftGroupId || null;

    // ручная правка авто-записи «отвязывает» её от источника — иначе следующий
    // авто-upsert (например, повторный переход заказа в «Оплачено») молча
    // затрёт правку менеджера своей исходной суммой
    if (before.source === FinanceSource.AUTO) {
      data.source = FinanceSource.MANUAL;
      data.autoKey = null;
    }

    const after = await this.prisma.financeEntry.update({ where: { id }, data });

    const changes = this.audit.diff(before, after, [
      'kind',
      'category',
      'amount',
      'date',
      'title',
      'comment',
      'orderId',
      'clientId',
      'shiftGroupId',
      'source',
    ]);
    await this.audit.log(this.prisma, {
      user,
      entity: 'FINANCE',
      entityId: id,
      entityTitle: this.entryTitle(after),
      action: AuditAction.UPDATE,
      changes,
    });

    return after;
  }

  async remove(user: AuthUser, id: string, reason?: string) {
    this.requireManage(user);

    const entry = await this.prisma.financeEntry.findFirst({ where: { id, ...NOT_DELETED } });
    if (!entry) throw new NotFoundException('Финансовая запись не найдена');

    await this.prisma.financeEntry.update({
      where: { id },
      data: softDeleteData(user, reason),
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'FINANCE',
      entityId: id,
      entityTitle: this.entryTitle(entry),
      action: AuditAction.DELETE,
      summary: reason ? `Причина: ${reason}` : undefined,
    });

    return { ok: true };
  }

  // ─────────────── ИНТЕГРАЦИЯ С ДРУГИМИ МОДУЛЯМИ ───────────────

  /**
   * Доход от оплаченного заказа (ТЗ 7.1). Вызывается ИЗ orders.service внутри
   * его же транзакции при переходе этапа заказа в «Оплачено».
   *
   * Идемпотентно: autoKey='order:<id>:income' — повторный вызов (например,
   * при уточнении суммы) обновит ту же запись, а не создаст дубль.
   */
  async recordOrderIncome(
    db: FinanceDb,
    order: OrderIncomeSource,
    user: AuthUser | null,
  ): Promise<void> {
    const amount = order.finalPrice ?? order.estimatedPrice ?? 0;
    if (amount <= 0) return; // нулевую/некорректную сумму в книгу доходов не пишем

    /*
     * Деньги приходят взносами (ТЗ 3.1): каждый взнос уже записан в книгу
     * доходов своей строкой — с каналом и датой получения. Общая строка по
     * заказу поверх них удвоила бы выручку, поэтому при наличии взносов её
     * не создаём. Ветка ниже осталась для заказов без взносов — например
     * закрытых до перехода на учёт оплат.
     */
    const payments = await db.orderPayment.count({
      where: { orderId: order.id, deletedAt: null },
    });
    if (payments > 0) return;

    const autoKey = `order:${order.id}:income`;
    const date = order.closedAt ?? new Date();

    const existing = await db.financeEntry.findUnique({ where: { autoKey } });

    // менеджер уже правил эту запись руками (source стал MANUAL) — новый переход
    // заказа в «Оплачено» не должен затирать его правку суммой из заказа;
    // единственное, что нам можно сделать — вернуть запись из корзины, если её
    // туда унесли предыдущим removeOrderIncome
    if (existing && existing.source === FinanceSource.MANUAL) {
      if (existing.deletedAt) {
        await db.financeEntry.update({
          where: { id: existing.id },
          data: { deletedAt: null, deletedById: null, deleteReason: null },
        });
      }
      return;
    }

    const entry = await db.financeEntry.upsert({
      where: { autoKey },
      create: {
        kind: FinanceKind.INCOME,
        category: FinanceCategory.ORDER_PAYMENT,
        amount,
        date,
        title: 'Оплата заказа',
        source: FinanceSource.AUTO,
        autoKey,
        orderId: order.id,
        clientId: order.clientId,
        createdById: user?.id ?? null,
        createdByName: user?.fullName ?? null,
      },
      update: {
        amount,
        date,
        orderId: order.id,
        clientId: order.clientId,
        deletedAt: null,
        deletedById: null,
        deleteReason: null,
      },
    });

    await this.audit.log(db, {
      user,
      entity: 'FINANCE',
      entityId: entry.id,
      entityTitle: this.entryTitle(entry),
      action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
      summary: 'Автодоход по оплате заказа',
    });
  }

  /**
   * Доход по конкретному взносу клиента (ТЗ 3.2).
   *
   * Раньше по заказу создавалась одна запись — в момент перехода в
   * «Оплачено». Предоплата в книге доходов не появлялась вовсе, а смешанную
   * оплату нечем было разделить по каналам. Теперь каждый взнос даёт свою
   * запись с указанием способа и банка, а ключ идемпотентности привязан к
   * платежу, поэтому правка взноса обновляет ту же строку, а не плодит новые.
   */
  async recordPaymentIncome(
    db: FinanceDb,
    payment: {
      id: string;
      orderId: string;
      amount: number;
      paidAt: Date;
      method: PaymentMethod | null;
      bankId: string | null;
      bank?: { title: string } | null;
    },
    clientId: string,
    user: AuthUser | null,
  ): Promise<void> {
    if (payment.amount <= 0) return;
    const autoKey = `payment:${payment.id}`;
    const channel = !payment.method
      ? 'способ не указан'
      : payment.method === 'CASH'
        ? 'наличные'
        : (payment.bank?.title ?? 'банк');
    const title = `Оплата заказа — ${channel}`;

    const existing = await db.financeEntry.findUnique({ where: { autoKey } });
    // менеджер правил запись руками — сумму из платежа не навязываем
    if (existing && existing.source === FinanceSource.MANUAL) {
      if (existing.deletedAt) {
        await db.financeEntry.update({
          where: { id: existing.id },
          data: { deletedAt: null, deletedById: null, deleteReason: null },
        });
      }
      return;
    }

    const entry = await db.financeEntry.upsert({
      where: { autoKey },
      create: {
        kind: FinanceKind.INCOME,
        category: FinanceCategory.ORDER_PAYMENT,
        amount: payment.amount,
        date: payment.paidAt,
        title,
        source: FinanceSource.AUTO,
        autoKey,
        orderId: payment.orderId,
        clientId,
        paymentMethod: payment.method,
        bankId: payment.bankId,
        createdById: user?.id ?? null,
        createdByName: user?.fullName ?? null,
      },
      update: {
        amount: payment.amount,
        date: payment.paidAt,
        title,
        paymentMethod: payment.method,
        bankId: payment.bankId,
        deletedAt: null,
        deletedById: null,
        deleteReason: null,
      },
    });

    await this.audit.log(db, {
      user,
      entity: 'FINANCE',
      entityId: entry.id,
      entityTitle: this.entryTitle(entry),
      action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
      summary: `Оплата по заказу — ${channel}`,
    });
  }

  /** Снятие дохода по удалённому взносу */
  async removePaymentIncome(
    db: FinanceDb,
    paymentId: string,
    user: AuthUser | null = null,
  ): Promise<void> {
    const autoKey = `payment:${paymentId}`;
    const entry = await db.financeEntry.findUnique({ where: { autoKey } });
    if (!entry || entry.deletedAt) return;
    if (entry.source === FinanceSource.MANUAL) return; // правили руками — не трогаем
    await db.financeEntry.update({
      where: { id: entry.id },
      data: {
        deletedAt: new Date(),
        deletedById: user?.id ?? null,
        deleteReason: 'Взнос по заказу удалён',
      },
    });
    await this.audit.log(db, {
      user,
      entity: 'FINANCE',
      entityId: entry.id,
      entityTitle: this.entryTitle(entry),
      action: AuditAction.DELETE,
      summary: 'Снят доход по удалённому взносу',
    });
  }

  /**
   * Снятие автодохода, когда заказ вышел из этапа «Оплачено» (отменена оплата,
   * заказ вернули на доработку и т.п.). Ручные правки (source=MANUAL) не трогает —
   * решение о судьбе такой записи остаётся за менеджером.
   */
  async removeOrderIncome(
    db: FinanceDb,
    orderId: string,
    user: AuthUser | null = null,
  ): Promise<void> {
    const autoKey = `order:${orderId}:income`;
    const entry = await db.financeEntry.findUnique({ where: { autoKey } });
    if (!entry || entry.deletedAt || entry.source !== FinanceSource.AUTO) return;

    await db.financeEntry.update({
      where: { id: entry.id },
      data: {
        deletedAt: new Date(),
        deletedById: user?.id ?? null,
        deleteReason: 'Заказ вышел из этапа «Оплачено»',
      },
    });

    await this.audit.log(db, {
      user,
      entity: 'FINANCE',
      entityId: entry.id,
      entityTitle: this.entryTitle(entry),
      action: AuditAction.DELETE,
      summary: 'Автодоход снят: заказ вышел из «Оплачено»',
    });
  }
}
