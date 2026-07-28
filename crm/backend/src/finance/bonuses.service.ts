import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, FinanceCategory, FinanceKind, FinanceSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { dayUTC, momentRange } from '../common/time/dushanbe';
import { CreateBonusDto, ListBonusDto, UpdateBonusDto } from './dto/bonus.dto';

function bonusTitle(bonus: { recipientName: string; amount: number }): string {
  return `Премия — ${bonus.recipientName} (${bonus.amount} с.)`;
}

/** «ГГГГ-ММ-ДД» → граница периода (только календарный день, без сдвига момента) */
function periodBoundary(value?: string): Date | null {
  return value ? dayUTC(value) : null;
}

/**
 * Премии (ТЗ 7.2) — только ручное начисление. При начислении в той же
 * транзакции создаётся связанный расход в книге доходов/расходов
 * (autoKey='bonus:<id>'), поэтому сервис зависит от FinanceService только
 * через Prisma — отдельного вызова наружу не требуется.
 */
@Injectable()
export class BonusesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private requireView(user: AuthUser): void {
    if (!can(user, 'finance:view')) {
      throw new ForbiddenException('Нет доступа к премиям');
    }
  }

  private requireManage(user: AuthUser): void {
    if (!can(user, 'finance:manage')) {
      throw new ForbiddenException('Начислять премии может только руководитель');
    }
  }

  list(user: AuthUser, q: ListBonusDto) {
    this.requireView(user);
    const where: Prisma.BonusWhereInput = { ...NOT_DELETED };
    if (q.userId) where.userId = q.userId;
    if (q.cleanerId) where.cleanerId = q.cleanerId;
    if (q.from || q.to) where.createdAt = momentRange(q.from, q.to);

    return this.prisma.bonus.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async create(user: AuthUser, dto: CreateBonusDto) {
    this.requireManage(user);

    // получатель — РОВНО один: клинер или сотрудник CRM (XOR, схема этого не гарантирует)
    const hasCleaner = Boolean(dto.cleanerId);
    const hasUser = Boolean(dto.userId);
    if (hasCleaner === hasUser) {
      throw new BadRequestException(
        'Укажите получателя премии — либо клинера, либо сотрудника, но не обоих сразу',
      );
    }

    let recipientName: string;
    if (dto.cleanerId) {
      const cleaner = await this.prisma.cleaner.findFirst({
        where: { id: dto.cleanerId, ...NOT_DELETED },
        select: { fullName: true },
      });
      if (!cleaner) throw new NotFoundException('Клинер не найден');
      recipientName = cleaner.fullName;
    } else {
      const recipient = await this.prisma.user.findFirst({
        where: { id: dto.userId, ...NOT_DELETED },
        select: { fullName: true },
      });
      if (!recipient) throw new NotFoundException('Сотрудник не найден');
      recipientName = recipient.fullName;
    }

    const periodFrom = periodBoundary(dto.periodFrom);
    const periodTo = periodBoundary(dto.periodTo);
    if (periodFrom && periodTo && periodFrom > periodTo) {
      throw new BadRequestException('Начало периода не может быть позже его окончания');
    }

    const reason = dto.reason.trim();
    const autoKey = (bonusId: string) => `bonus:${bonusId}`;

    return this.prisma.$transaction(async (tx) => {
      const bonus = await tx.bonus.create({
        data: {
          cleanerId: dto.cleanerId || null,
          userId: dto.userId || null,
          recipientName,
          amount: dto.amount,
          reason,
          periodFrom,
          periodTo,
          createdById: user.id,
          createdByName: user.fullName,
        },
      });

      // расход в книге создаётся сразу и той же транзакцией — премия без
      // отражения в финансах ломала бы сводку доходов/расходов (ТЗ 7.1)
      await tx.financeEntry.create({
        data: {
          kind: FinanceKind.EXPENSE,
          category: FinanceCategory.BONUS,
          amount: bonus.amount,
          date: new Date(),
          title: bonusTitle(bonus),
          comment: reason,
          source: FinanceSource.AUTO,
          autoKey: autoKey(bonus.id),
          bonusId: bonus.id,
          createdById: user.id,
          createdByName: user.fullName,
        },
      });

      await this.audit.log(tx, {
        user,
        entity: 'BONUS',
        entityId: bonus.id,
        entityTitle: bonusTitle(bonus),
        action: AuditAction.CREATE,
        summary: reason,
      });

      return bonus;
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateBonusDto) {
    this.requireManage(user);

    const before = await this.prisma.bonus.findFirst({ where: { id, ...NOT_DELETED } });
    if (!before) throw new NotFoundException('Премия не найдена');

    const periodFrom = dto.periodFrom !== undefined ? periodBoundary(dto.periodFrom) : undefined;
    const periodTo = dto.periodTo !== undefined ? periodBoundary(dto.periodTo) : undefined;
    if ((periodFrom ?? before.periodFrom) && (periodTo ?? before.periodTo)) {
      const from = periodFrom ?? before.periodFrom;
      const to = periodTo ?? before.periodTo;
      if (from && to && from > to) {
        throw new BadRequestException('Начало периода не может быть позже его окончания');
      }
    }

    const data: Prisma.BonusUncheckedUpdateInput = {};
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.reason !== undefined) data.reason = dto.reason.trim();
    if (periodFrom !== undefined) data.periodFrom = periodFrom;
    if (periodTo !== undefined) data.periodTo = periodTo;

    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bonus.update({ where: { id }, data });

      // сумму поправили руками — синхронизируем связанный расход в книге,
      // иначе сводка по статье BONUS разойдётся с фактическим начислением
      if (dto.amount !== undefined && dto.amount !== before.amount) {
        await tx.financeEntry.updateMany({
          where: { autoKey: `bonus:${id}` },
          data: { amount: dto.amount, title: bonusTitle(updated) },
        });
      }
      if (dto.reason !== undefined) {
        await tx.financeEntry.updateMany({
          where: { autoKey: `bonus:${id}` },
          data: { comment: updated.reason },
        });
      }

      const changes = this.audit.diff(before, updated, ['amount', 'reason', 'periodFrom', 'periodTo']);
      await this.audit.log(tx, {
        user,
        entity: 'BONUS',
        entityId: id,
        entityTitle: bonusTitle(updated),
        action: AuditAction.UPDATE,
        changes,
      });

      return updated;
    });

    return after;
  }

  /** Отметка о выплате (ТЗ 7.2) — сама выплата фиксируется ведомостью/кассой, здесь только факт */
  async pay(user: AuthUser, id: string) {
    this.requireManage(user);

    const bonus = await this.prisma.bonus.findFirst({ where: { id, ...NOT_DELETED } });
    if (!bonus) throw new NotFoundException('Премия не найдена');
    if (bonus.paidAt) throw new BadRequestException('Премия уже отмечена как выплаченная');

    const updated = await this.prisma.bonus.update({
      where: { id },
      data: { paidAt: new Date() },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'BONUS',
      entityId: id,
      entityTitle: bonusTitle(updated),
      action: AuditAction.UPDATE,
      summary: 'Отмечена как выплаченная',
    });

    return updated;
  }

  async remove(user: AuthUser, id: string, reason?: string) {
    this.requireManage(user);

    const bonus = await this.prisma.bonus.findFirst({ where: { id, ...NOT_DELETED } });
    if (!bonus) throw new NotFoundException('Премия не найдена');

    await this.prisma.$transaction(async (tx) => {
      await tx.bonus.update({ where: { id }, data: softDeleteData(user, reason) });
      // связанный расход уносим в корзину вместе с премией — иначе отменённая
      // премия продолжит уменьшать прибыль в сводке (ТЗ 7.1)
      await tx.financeEntry.updateMany({
        where: { autoKey: `bonus:${id}` },
        data: softDeleteData(user, reason ?? 'Премия отменена'),
      });

      await this.audit.log(tx, {
        user,
        entity: 'BONUS',
        entityId: id,
        entityTitle: bonusTitle(bonus),
        action: AuditAction.DELETE,
        summary: reason ? `Причина: ${reason}` : undefined,
      });
    });

    return { ok: true };
  }
}
