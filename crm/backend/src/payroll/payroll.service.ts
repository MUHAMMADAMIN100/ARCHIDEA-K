import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { NOT_DELETED } from '../common/soft-delete';
import {
  dayUTC as toDayUTC,
  formatDate,
  todayDushanbe,
} from '../common/time/dushanbe';

/**
 * «ГГГГ-ММ-ДД» → полночь UTC (одна смена = один календарный день).
 * Расчёт живёт в common/time/dushanbe — здесь только проверка формата,
 * чтобы кривая строка из формы не превращалась в Invalid Date.
 */
function dayUTC(dateStr: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new BadRequestException('Неверный формат даты (ожидается ГГГГ-ММ-ДД)');
  }
  return toDayUTC(dateStr);
}

function rangeUTC(from?: string, to?: string) {
  const gte = from ? dayUTC(from) : undefined;
  const lte = to ? new Date(dayUTC(to).getTime() + 24 * 3600 * 1000 - 1) : undefined;
  return { gte, lte };
}

const cleanerSelect = {
  id: true,
  fullName: true,
  rate: true,
  brigade: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ─────────────── СМЕНЫ ───────────────

  /** Смены за период (для страницы учёта) */
  listShifts(from?: string, to?: string) {
    return this.prisma.shift.findMany({
      where: { date: rangeUTC(from, to) },
      include: { cleaner: { select: cleanerSelect } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Отметка смен за день: синхронизация списка.
   * Кто отмечен галочкой — у того смена есть; снятые галочки удаляются.
   * baseline — список тех, кого клиент ВИДЕЛ при загрузке: удаляем только их,
   * чтобы не стереть смены, отмеченные параллельно с другого устройства.
   */
  async markDay(
    user: AuthUser,
    dto: {
      date: string;
      cleanerIds: string[];
      baseline?: string[];
      note?: string;
    },
  ) {
    const date = dayUTC(dto.date);
    const ids = Array.from(new Set(dto.cleanerIds ?? []));
    // baseline — кого клиент ВИДЕЛ при загрузке; удаляем ТОЛЬКО их снятые
    // отметки. Если baseline не передан — не удаляем ничего (иначе запрос
    // {cleanerIds:[]} без baseline стёр бы все смены дня — порча выплат).
    const baseline = new Set(dto.baseline ?? []);

    const cleaners = await this.prisma.cleaner.findMany({
      where: { id: { in: ids }, ...NOT_DELETED },
      select: { id: true, rate: true },
    });
    if (cleaners.length !== ids.length) {
      throw new BadRequestException('Некоторые клинеры не найдены');
    }

    const existing = await this.prisma.shift.findMany({
      where: { date },
      select: { id: true, cleanerId: true },
    });
    const existingIds = new Set(existing.map((s) => s.cleanerId));
    const toDelete = existing.filter(
      (s) => !ids.includes(s.cleanerId) && baseline.has(s.cleanerId),
    );
    const toCreate = cleaners.filter((c) => !existingIds.has(c.id));

    await this.prisma.$transaction([
      this.prisma.shift.deleteMany({
        where: { id: { in: toDelete.map((s) => s.id) } },
      }),
      this.prisma.shift.createMany({
        data: toCreate.map((c) => ({
          date,
          cleanerId: c.id,
          rate: c.rate, // снапшот ставки на день смены
          note: dto.note || null,
        })),
      }),
    ]);

    // ТЗ 2: смены — одна из сущностей, изменения которых обязаны фиксироваться
    if (toCreate.length || toDelete.length) {
      const names = new Map(cleaners.map((c) => [c.id, c.id]));
      await this.audit.log(this.prisma, {
        user,
        entity: 'SHIFT',
        entityId: dto.date,
        entityTitle: `Смены за ${formatDate(date)}`,
        action: AuditAction.UPDATE,
        summary:
          `Отмечено: +${toCreate.length}, снято: ${toDelete.length}` +
          (names.size ? '' : ''),
      });
    }

    return this.prisma.shift.findMany({
      where: { date },
      include: { cleaner: { select: cleanerSelect } },
    });
  }

  async removeShift(user: AuthUser, id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: { cleaner: { select: { fullName: true } } },
    });
    if (!shift) throw new NotFoundException('Смена не найдена');
    await this.prisma.shift.delete({ where: { id } });

    await this.audit.log(this.prisma, {
      user,
      entity: 'SHIFT',
      entityId: id,
      entityTitle: `Смена ${shift.cleaner.fullName} — ${formatDate(shift.date)}`,
      action: AuditAction.DELETE,
      summary: `Отметка смены снята (ставка ${shift.rate} сомони)`,
    });
    return { ok: true };
  }

  // ─────────────── ШТРАФЫ ───────────────

  listFines(from?: string, to?: string, cleanerId?: string) {
    return this.prisma.fine.findMany({
      where: {
        date: rangeUTC(from, to),
        ...(cleanerId ? { cleanerId } : {}),
      },
      include: { cleaner: { select: cleanerSelect } },
      orderBy: { date: 'desc' },
    });
  }

  async createFine(
    user: AuthUser,
    dto: { cleanerId: string; amount: number; reason: string; date?: string },
  ) {
    const amount = Math.round(Number(dto.amount));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 2_000_000_000) {
      throw new BadRequestException('Укажите корректную сумму штрафа');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Укажите причину штрафа');
    }
    const cleaner = await this.prisma.cleaner.findFirst({
      where: { id: dto.cleanerId, ...NOT_DELETED },
    });
    if (!cleaner) throw new NotFoundException('Клинер не найден');

    // дата нормализуется к календарному дню по Душанбе, иначе штраф «сегодня»
    // мог бы выпасть из выборок за день
    const fine = await this.prisma.fine.create({
      data: {
        cleanerId: dto.cleanerId,
        amount,
        reason: dto.reason.trim(),
        date: dayUTC(dto.date || todayDushanbe()),
        createdById: user.id,
      },
      include: { cleaner: { select: cleanerSelect } },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'CLEANER',
      entityId: dto.cleanerId,
      entityTitle: cleaner.fullName,
      action: AuditAction.UPDATE,
      summary: `Штраф ${amount} сомони за ${formatDate(fine.date)}: ${fine.reason}`,
    });
    return fine;
  }

  async removeFine(user: AuthUser, id: string) {
    const fine = await this.prisma.fine.findUnique({
      where: { id },
      include: { cleaner: { select: { id: true, fullName: true } } },
    });
    if (!fine) throw new NotFoundException('Штраф не найден');
    await this.prisma.fine.delete({ where: { id } });

    await this.audit.log(this.prisma, {
      user,
      entity: 'CLEANER',
      entityId: fine.cleanerId,
      entityTitle: fine.cleaner.fullName,
      action: AuditAction.UPDATE,
      summary: `Штраф ${fine.amount} сомони отменён`,
    });
    return { ok: true };
  }

  // ─────────────── ВЫПЛАТЫ ───────────────

  /**
   * Сводка выплат за период: по каждому клинеру —
   * смены × ставка (снапшот) − штрафы = к выплате.
   */
  async summary(from?: string, to?: string) {
    const dateRange = rangeUTC(from, to);
    const [cleaners, shifts, fines] = await Promise.all([
      this.prisma.cleaner.findMany({
        where: NOT_DELETED,
        select: { ...cleanerSelect, brigadeId: true, isActive: true },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.shift.findMany({
        where: { date: dateRange },
        select: { cleanerId: true, rate: true },
      }),
      this.prisma.fine.findMany({
        where: { date: dateRange },
        select: { cleanerId: true, amount: true },
      }),
    ]);

    const shiftAgg = new Map<string, { count: number; accrued: number }>();
    for (const s of shifts) {
      const agg = shiftAgg.get(s.cleanerId) ?? { count: 0, accrued: 0 };
      agg.count += 1;
      agg.accrued += s.rate;
      shiftAgg.set(s.cleanerId, agg);
    }
    const fineAgg = new Map<string, number>();
    for (const f of fines) {
      fineAgg.set(f.cleanerId, (fineAgg.get(f.cleanerId) ?? 0) + f.amount);
    }

    // активные — всегда; отключённые — только если у них есть смены/штрафы в периоде
    const rows = cleaners
      .map((c) => {
        const sh = shiftAgg.get(c.id) ?? { count: 0, accrued: 0 };
        const fined = fineAgg.get(c.id) ?? 0;
        return {
          cleanerId: c.id,
          fullName: c.fullName,
          rate: c.rate,
          brigade: c.brigade?.name ?? null,
          brigadeId: c.brigadeId,
          shifts: sh.count,
          accrued: sh.accrued,
          fines: fined,
          total: sh.accrued - fined,
          isActive: c.isActive,
        };
      })
      .filter((r) => r.isActive || r.shifts > 0 || r.fines > 0);

    const totals = rows.reduce(
      (acc, r) => ({
        shifts: acc.shifts + r.shifts,
        accrued: acc.accrued + r.accrued,
        fines: acc.fines + r.fines,
        total: acc.total + r.total,
      }),
      { shifts: 0, accrued: 0, fines: 0, total: 0 },
    );

    return { rows, totals };
  }
}
