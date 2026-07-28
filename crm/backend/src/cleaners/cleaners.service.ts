import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { dayKey, dayUTC } from '../common/time/dushanbe';

const brigadeInclude = {
  leader: { select: { id: true, fullName: true } },
  cleaners: {
    orderBy: { fullName: 'asc' as const },
    select: {
      id: true,
      fullName: true,
      phone: true,
      rate: true,
      duties: true,
      isActive: true,
      brigadeId: true,
    },
  },
};

@Injectable()
export class CleanersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Все клинеры компании (бригады общие — видят обе роли).
   *
   * activeOnly используется формой назначения на заказ: уволенных клинеров
   * там быть не должно, иначе их снова назначают на выезд. «Удаление» клинера
   * с историей смен — это как раз перевод в isActive: false.
   */
  list(_user: AuthUser, activeOnly = false) {
    return this.prisma.cleaner.findMany({
      where: { ...NOT_DELETED, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: { fullName: 'asc' },
      include: {
        manager: { select: { id: true, fullName: true } },
        brigade: { select: { id: true, name: true } },
      },
    });
  }

  create(
    user: AuthUser,
    data: {
      fullName: string;
      phone?: string;
      rate?: number;
      brigadeId?: string;
      managerId?: string;
    },
  ) {
    if (!data.fullName?.trim()) {
      throw new BadRequestException('Укажите имя клинера');
    }
    const managerId = seesAll(user) ? data.managerId ?? user.id : user.id;
    const rate = Math.round(Number(data.rate));
    const safeRate = Number.isFinite(rate) && rate > 0 && rate <= 2_000_000_000
      ? rate
      : 230;
    return this.prisma.cleaner.create({
      data: {
        fullName: data.fullName.trim(),
        phone: data.phone,
        rate: safeRate,
        brigadeId: data.brigadeId || null,
        managerId,
      },
      include: { brigade: { select: { id: true, name: true } } },
    });
  }

  async update(
    user: AuthUser,
    id: string,
    data: {
      fullName?: string;
      phone?: string;
      rate?: number;
      brigadeId?: string | null;
      isActive?: boolean;
      duties?: string;
    },
  ) {
    const before = await this.prisma.cleaner.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!before) throw new NotFoundException('Клинер не найден');

    const patch: any = {};
    if (data.fullName !== undefined) patch.fullName = data.fullName.trim();
    if (data.phone !== undefined) patch.phone = data.phone || null;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.brigadeId !== undefined) patch.brigadeId = data.brigadeId || null;
    if (data.duties !== undefined) patch.duties = data.duties || null;
    if (data.rate !== undefined) {
      const rate = Math.round(Number(data.rate));
      if (!Number.isFinite(rate) || rate <= 0 || rate > 2_000_000_000) {
        throw new BadRequestException('Укажите корректную ставку');
      }
      patch.rate = rate;
    }

    const after = await this.prisma.cleaner.update({
      where: { id },
      data: patch,
      include: { brigade: { select: { id: true, name: true } } },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'CLEANER',
      entityId: after.id,
      entityTitle: after.fullName,
      action: AuditAction.UPDATE,
      changes: this.audit.diff(before, after, [
        'fullName',
        'phone',
        'rate',
        'brigadeId',
        'isActive',
        'duties',
      ]),
    });
    return after;
  }

  /**
   * Удаление клинера переносит его в корзину (ТЗ 6).
   * Если за ним есть смены или штрафы — он ещё и снимается с работы и выводится
   * из бригады: иначе он останется в расчёте выплат и в составе выездов,
   * а суммы за прошлые месяцы поедут.
   */
  async remove(user: AuthUser, id: string, reason?: string) {
    const cleaner = await this.prisma.cleaner.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!cleaner) throw new NotFoundException('Клинер не найден');

    const [shifts, fines] = await Promise.all([
      this.prisma.shift.count({ where: { cleanerId: id } }),
      this.prisma.fine.count({ where: { cleanerId: id } }),
    ]);

    const removed = await this.prisma.cleaner.update({
      where: { id },
      data: { ...softDeleteData(user, reason), isActive: false, brigadeId: null },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'CLEANER',
      entityId: id,
      entityTitle: cleaner.fullName,
      action: AuditAction.DELETE,
      summary:
        shifts > 0 || fines > 0
          ? `Перенесён в корзину; история сохранена (смен: ${shifts}, штрафов: ${fines})`
          : 'Перенесён в корзину',
    });
    return removed;
  }

  // ─────────────── БРИГАДЫ ───────────────

  listBrigades() {
    return this.prisma.brigade.findMany({
      include: brigadeInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  createBrigade(data: { name: string }) {
    if (!data.name?.trim()) throw new BadRequestException('Укажите название');
    return this.prisma.brigade.create({
      data: { name: data.name.trim() },
      include: brigadeInclude,
    });
  }

  async updateBrigade(
    id: string,
    data: { name?: string; leaderId?: string | null },
  ) {
    const brigade = await this.prisma.brigade.findUnique({ where: { id } });
    if (!brigade) throw new NotFoundException('Бригада не найдена');

    const patch: any = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.leaderId !== undefined && data.leaderId) {
      const leader = await this.prisma.cleaner.findUnique({
        where: { id: data.leaderId },
      });
      if (!leader) throw new NotFoundException('Клинер не найден');
    }
    if (data.leaderId === undefined) {
      return this.prisma.brigade.update({
        where: { id },
        data: patch,
        include: brigadeInclude,
      });
    }
    // атомарно: снимаем лидерство в другой бригаде (leaderId уникален),
    // переводим клинера в эту бригаду и назначаем бригадиром
    patch.leaderId = data.leaderId || null;
    const ops: any[] = [];
    if (data.leaderId) {
      ops.push(
        this.prisma.brigade.updateMany({
          where: { leaderId: data.leaderId, id: { not: id } },
          data: { leaderId: null },
        }),
        this.prisma.cleaner.update({
          where: { id: data.leaderId },
          data: { brigadeId: id },
        }),
      );
    }
    ops.push(
      this.prisma.brigade.update({
        where: { id },
        data: patch,
        include: brigadeInclude,
      }),
    );
    const results = await this.prisma.$transaction(ops);
    return results[results.length - 1];
  }

  async removeBrigade(id: string) {
    const brigade = await this.prisma.brigade.findUnique({ where: { id } });
    if (!brigade) throw new NotFoundException('Бригада не найдена');
    await this.prisma.brigade.delete({ where: { id } }); // клинеры остаются (brigadeId → null)
    return { ok: true };
  }

  /**
   * Задания команды на день: заказы в работе с назначенными клинерами.
   * Границы суток берём по Душанбе (UTC+5), а не по времени сервера —
   * иначе «сегодня» на экране начинается в 5 утра по местному времени.
   */
  async teamTasksForDay(user: AuthUser, dateStr?: string) {
    const key = dateStr ? dayKey(new Date(dateStr)) : dayKey(new Date());
    const start = new Date(dayUTC(key).getTime() - 5 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

    const where: any = {
      ...NOT_DELETED,
      stage: { in: ['CONFIRMED', 'IN_PROGRESS'] },
      scheduledDate: { gte: start, lte: end },
    };
    if (!seesAll(user)) where.managerId = user.id;

    return this.prisma.order.findMany({
      where,
      include: {
        client: { select: { fullName: true, phone: true } },
        cleaners: { select: { id: true, fullName: true } },
        manager: { select: { id: true, fullName: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });
  }
}
