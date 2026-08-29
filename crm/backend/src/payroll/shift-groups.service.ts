import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, ShiftGroupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { guestsOf } from '../common/order-guests';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { dayKey, dayUTC, formatDate, rangeUTC } from '../common/time/dushanbe';
import {
  CloseShiftGroupDto,
  CreateShiftGroupDto,
  UpdateShiftGroupDto,
} from './dto/shift-group.dto';

/** Участник выезда в том виде, в каком он уходит в базу */
interface VisitMember {
  cleanerId: string | null;
  isGuest: boolean;
  fullName: string;
  rate: number;
  role: string;
}

const groupInclude = {
  members: { orderBy: { fullName: 'asc' as const } },
  order: {
    select: {
      id: true,
      address: true,
      client: { select: { id: true, fullName: true, phone: true } },
    },
  },
  shifts: { select: { id: true, cleanerId: true, rate: true } },
};

/**
 * Дни уборки: от первого до последнего включительно.
 *
 * Пустой последний день — один день, как было всегда. Предел в 31 день —
 * защита от опечатки в году: без него «2027» вместо «2026» породило бы
 * сотни выездов одним нажатием.
 */
function daysBetween(start: Date, end: Date | null | undefined): string[] {
  const первый = dayKey(start);
  if (!end) return [первый];
  const последний = dayKey(end);
  if (последний <= первый) return [первый];
  const дни: string[] = [];
  const курсор = dayUTC(первый);
  const предел = dayUTC(последний);
  while (курсор <= предел && дни.length < 31) {
    дни.push(курсор.toISOString().slice(0, 10));
    курсор.setUTCDate(курсор.getUTCDate() + 1);
  }
  return дни;
}

/**
 * Выезды бригад на объекты (ТЗ 4).
 *
 * Раньше смена была просто отметкой «клинер работал в такой-то день»: ни адреса,
 * ни состава группы, ни привязки к заказу — на вопрос «куда выезжали и с кем»
 * ответить было нечем. Теперь выезд хранит адрес, время, поимённый состав и
 * ответственных, а при закрытии делает неизменяемый слепок для отчётности.
 *
 * Оплачиваемые смены (Shift) остаются отдельной сущностью: один клинер —
 * один оплаченный день. Это защищает от двойного начисления, если человек
 * за день съездил на два объекта.
 */

@Injectable()
export class ShiftGroupsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  private titleOf(g: {
    address: string;
    date: Date;
  }): string {
    return `Выезд ${formatDate(g.date)} — ${g.address}`;
  }

  /** Проверяем состав: уволенных и удалённых на выезд не отправляем */
  private async resolveMembers(cleanerIds?: string[]) {
    const ids = [...new Set((cleanerIds ?? []).filter(Boolean))];
    if (ids.length === 0) return [];

    const cleaners = await this.prisma.cleaner.findMany({
      where: { id: { in: ids }, isActive: true, ...NOT_DELETED },
      select: {
        id: true,
        fullName: true,
        rate: true,
        leaderOf: { select: { id: true } },
      },
    });
    if (cleaners.length !== ids.length) {
      throw new BadRequestException(
        'Часть выбранных клинеров недоступна: они уволены или удалены',
      );
    }
    return cleaners.map((c) => ({
      cleanerId: c.id,
      fullName: c.fullName,
      // ставка — снапшот на день выезда: пересчёт задним числом не должен
      // менять уже начисленные суммы
      rate: c.rate,
      role: c.leaderOf ? 'Бригадир' : 'Клинер',
    }));
  }

  async list(q: {
    from?: string;
    to?: string;
    status?: ShiftGroupStatus;
    orderId?: string;
    search?: string;
  }) {
    const where: Prisma.ShiftGroupWhereInput = { ...NOT_DELETED };
    const range = rangeUTC(q.from, q.to);
    if (range.gte || range.lte) where.date = range;
    if (q.status) where.status = q.status;
    if (q.orderId) where.orderId = q.orderId;
    if (q.search?.trim()) {
      const term = q.search.trim();
      where.OR = [
        { address: { contains: term, mode: 'insensitive' } },
        { brigadeName: { contains: term, mode: 'insensitive' } },
        { members: { some: { fullName: { contains: term, mode: 'insensitive' } } } },
      ];
    }

    return this.prisma.shiftGroup.findMany({
      where,
      include: groupInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getOne(id: string) {
    const group = await this.prisma.shiftGroup.findFirst({
      where: { id, ...NOT_DELETED },
      include: groupInclude,
    });
    if (!group) throw new NotFoundException('Выезд не найден');
    return group;
  }

  /** Гостевые строки состава: имя + выплата, без ссылки на базу клинеров */
  private guestRows(guests?: { fullName: string; rate: number }[]): VisitMember[] {
    return (guests ?? [])
      .map((g) => ({
        cleanerId: null,
        isGuest: true,
        fullName: g.fullName.trim(),
        rate: Math.max(0, Math.round(Number(g.rate) || 0)),
        role: 'Разовый',
      }))
      .filter((g) => g.fullName.length > 0);
  }

  async create(user: AuthUser, dto: CreateShiftGroupDto) {
    const members = [
      ...(await this.resolveMembers(dto.cleanerIds)),
      ...this.guestRows(dto.guests),
    ];

    // Бригада и ответственные хранятся снапшотом: бригаду могут переименовать
    // или расформировать, а история выезда должна остаться читаемой
    const [brigade, brigadier, manager, order] = await Promise.all([
      dto.brigadeId
        ? this.prisma.brigade.findUnique({ where: { id: dto.brigadeId } })
        : null,
      dto.brigadierId
        ? this.prisma.cleaner.findUnique({ where: { id: dto.brigadierId } })
        : null,
      dto.managerId
        ? this.prisma.user.findUnique({ where: { id: dto.managerId } })
        : null,
      dto.orderId
        ? this.prisma.order.findFirst({
            where: { id: dto.orderId, ...NOT_DELETED },
            select: { id: true, address: true },
          })
        : null,
    ]);
    if (dto.orderId && !order) throw new NotFoundException('Заказ не найден');

    const created = await this.prisma.$transaction(async (tx) => {
      const group = await tx.shiftGroup.create({
        data: {
          date: dayUTC(dto.date.slice(0, 10)),
          address: dto.address.trim(),
          orderId: order?.id ?? null,
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          brigadeId: brigade?.id ?? null,
          brigadeName: brigade?.name ?? null,
          brigadierId: brigadier?.id ?? null,
          brigadierName: brigadier?.fullName ?? null,
          managerId: manager?.id ?? user.id,
          managerName: manager?.fullName ?? user.fullName,
          note: dto.note ?? null,
          createdById: user.id,
          members: { create: members },
        },
        include: groupInclude,
      });

      await this.audit.log(tx, {
        user,
        entity: 'SHIFT_GROUP',
        entityId: group.id,
        entityTitle: this.titleOf(group),
        action: AuditAction.CREATE,
        summary: `Запланирован выезд, состав: ${
          members.map((m) => m.fullName).join(', ') || '—'
        }`,
      });
      return group;
    });

    return created;
  }

  /**
   * Выезд по заказу, дошедшему до этапа «Осмотр объекта».
   *
   * Осмотр — это фактический выезд на объект, и раньше менеджер заводил его
   * в «Сменах» руками, повторно вбивая адрес, дату, состав и ответственного —
   * всё то, что уже есть в карточке заказа. Теперь выезд появляется сам.
   *
   * Заполняем тем, что известно на момент осмотра: адрес заказа, дату уборки
   * (или сегодняшнюю, если не согласована), назначенную команду и менеджера
   * заказа. Пустой адрес не повод отказать в создании — иначе выезда просто
   * не будет, и человек про него забудет; вместо этого ставим явную пометку,
   * которую видно в списке.
   *
   * Повторный заход на этап второй выезд не создаёт.
   */
  async createFromOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    fallbackUserId: string,
  ): Promise<{ id: string } | null> {
    const existing = await tx.shiftGroup.findFirst({
      where: { orderId, ...NOT_DELETED },
      select: { id: true },
    });
    if (existing) return null;
    return this.createVisitsForOrder(tx, orderId, fallbackUserId, 'inspection');
  }

  /** Заказ так, как его видят выезды: адрес, даты, команда, менеджер */
  private orderForVisits(tx: Prisma.TransactionClient, orderId: string) {
    return tx.order.findFirst({
      where: { id: orderId, ...NOT_DELETED },
      select: {
        id: true,
        address: true,
        scheduledDate: true,
        scheduledEndDate: true,
        preferredDate: true,
        preferredTime: true,
        managerId: true,
        manager: { select: { id: true, fullName: true } },
        cleaners: {
          select: {
            id: true,
            fullName: true,
            rate: true,
            brigadeId: true,
            leaderOf: { select: { id: true } },
          },
        },
        // разовые сотрудники заказа — они тоже делали уборку
        guestCleaners: true,
      },
    });
  }

  /**
   * Команда заказа глазами выезда: состав со снапшотом ставок, бригадир
   * (кто из команды ведёт бригаду) и бригада (по первому, у кого она есть).
   */
  private async teamOf(
    tx: Prisma.TransactionClient,
    order: {
      cleaners: {
        id: string;
        fullName: string;
        rate: number;
        brigadeId: string | null;
        leaderOf: { id: string } | null;
      }[];
      guestCleaners?: unknown;
    },
  ) {
    /*
     * Состав выезда = штатные клинеры + разовые сотрудники заказа.
     *
     * Разовых раньше здесь не было вовсе: человека звали на один раз, отдавали
     * ему деньги наличными, а в выезде он не появлялся — выходило, что убирал
     * никто. Смену ему не начислить (его нет в базе клинеров), но в составе
     * выезда он обязан быть: по нему видно, кто на объекте работал и сколько
     * получил.
     */
    const staff: VisitMember[] = order.cleaners.map((c) => ({
      cleanerId: c.id,
      isGuest: false,
      fullName: c.fullName,
      rate: c.rate,
      role: c.leaderOf ? 'Бригадир' : 'Клинер',
    }));
    /*
     * Разовый идёт ТОЛЬКО в первый день уборки.
     *
     * Штатному начисляется смена за каждый день — это его ставка. Разовому
     * вписывают сумму на руки целиком, за всю работу: «Хавасмох, 360 за два
     * дня». Положив эту строку в каждый день, учёт удвоил бы отданные
     * деньги — за двухдневный объект получилось бы 720.
     */
    const guests = this.guestRows(guestsOf(order.guestCleaners));
    // бригада и бригадир — по составу: если в команде есть бригадир, он и ведёт выезд
    const leader = order.cleaners.find((c) => c.leaderOf) ?? null;
    const brigadeId =
      order.cleaners.find((c) => c.brigadeId)?.brigadeId ?? null;
    const brigade = brigadeId
      ? await tx.brigade.findUnique({
          where: { id: brigadeId },
          select: { id: true, name: true },
        })
      : null;
    return { staff, guests, leader, brigade };
  }

  /** Состав выезда за день: разовые — только в первый */
  private membersOfDay(
    team: { staff: VisitMember[]; guests: VisitMember[] },
    индекс: number,
  ): VisitMember[] {
    return индекс === 0 ? [...team.staff, ...team.guests] : team.staff;
  }

  /**
   * Создаёт выезд на каждый день уборки по данным заказа.
   * `reason` — откуда взялся выезд: этап «Осмотр объекта» или выбранная
   * в карточке команда; это видно в заметке выезда.
   */
  private async createVisitsForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    fallbackUserId: string,
    reason: 'inspection' | 'team',
  ): Promise<{ id: string } | null> {
    const order = await this.orderForVisits(tx, orderId);
    if (!order) return null;
    const team = await this.teamOf(tx, order);
    const { leader, brigade } = team;
    const источник =
      reason === 'inspection'
        ? 'Создан автоматически на этапе «Осмотр объекта»'
        : 'Создан автоматически по команде из карточки заказа';
    const when = order.scheduledDate ?? order.preferredDate ?? new Date();
    /*
     * Уборка на несколько дней — выезд на КАЖДЫЙ день.
     *
     * Иначе бригада выходит два дня, а в учёте стоит один выезд: клинерам
     * начислится одна смена вместо двух. Смена — единица оплаты, и терять
     * день нельзя. Один день (дата окончания пуста) даёт ровно один выезд,
     * как было раньше.
     */
    const дни = daysBetween(when, order.scheduledEndDate);
    let первый: { id: string } | null = null;
    for (const [индекс, день] of дни.entries()) {
      const созданный = await tx.shiftGroup.create({
        data: {
          date: dayUTC(день),
          address: order.address?.trim() || 'Адрес не указан',
          orderId: order.id,
          startTime: order.preferredTime ?? null,
          brigadeId: brigade?.id ?? null,
          brigadeName: brigade?.name ?? null,
          brigadierId: leader?.id ?? null,
          brigadierName: leader?.fullName ?? null,
          managerId: order.managerId ?? fallbackUserId,
          managerName: order.manager?.fullName ?? null,
          note:
            дни.length > 1
              ? `${источник} — день ${индекс + 1} из ${дни.length}`
              : источник,
          createdById: fallbackUserId,
          members: { create: this.membersOfDay(team, индекс) },
        },
        select: { id: true },
      });
      if (!первый) первый = созданный;
    }
    return первый;
  }

  /**
   * Выезды следуют за карточкой заказа (решение владельца).
   *
   * Раньше выезд создавался один раз — на этапе «Осмотр объекта» — с тем
   * составом, что был в карточке в ту секунду. Клинеров, выбранных позже,
   * выезд не видел, и в «Сменах» команда была неполной. Теперь при любой
   * правке заказа (команда, адрес, даты, менеджер) открытые выезды заказа
   * подтягиваются к карточке, а если выездов ещё нет и команда выбрана —
   * они создаются, по одному на каждый день уборки.
   *
   * Что не трогаем: закрытые выезды (они архив), разовых клинеров в составе
   * (их нет в карточке заказа) и ставки уже добавленных участников (снапшот
   * на день выезда). Лишние автоматические выезды, если дней стало меньше,
   * уходят в корзину — заведённые руками остаются.
   */
  async syncFromOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    user: AuthUser,
    opts: { createIfMissing?: boolean } = {},
  ): Promise<{ created: number; updated: number }> {
    const order = await this.orderForVisits(tx, orderId);
    if (!order) return { created: 0, updated: 0 };
    const existing = await tx.shiftGroup.findMany({
      where: { orderId, ...NOT_DELETED },
      include: { members: true },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    if (existing.length === 0) {
      if (order.cleaners.length === 0 && !opts.createIfMissing) {
        return { created: 0, updated: 0 };
      }
      const first = await this.createVisitsForOrder(tx, orderId, user.id, 'team');
      return { created: first ? 1 : 0, updated: 0 };
    }

    const team = await this.teamOf(tx, order);
    const { leader, brigade } = team;
    const when = order.scheduledDate ?? order.preferredDate ?? existing[0].date;
    const дни = daysBetween(when, order.scheduledEndDate);
    let updated = 0;
    let created = 0;
    for (const [индекс, день] of дни.entries()) {
      const visit = existing[индекс];
      if (!visit) {
        // дней стало больше — новый выезд на добавленный день
        await tx.shiftGroup.create({
          data: {
            date: dayUTC(день),
            address: order.address?.trim() || 'Адрес не указан',
            orderId: order.id,
            startTime: order.preferredTime ?? null,
            brigadeId: brigade?.id ?? null,
            brigadeName: brigade?.name ?? null,
            brigadierId: leader?.id ?? null,
            brigadierName: leader?.fullName ?? null,
            managerId: order.managerId ?? user.id,
            managerName: order.manager?.fullName ?? null,
            note: `Создан автоматически по команде из карточки заказа — день ${индекс + 1} из ${дни.length}`,
            createdById: user.id,
            members: { create: this.membersOfDay(team, индекс) },
          },
        });
        created += 1;
        continue;
      }
      if (visit.status === ShiftGroupStatus.CLOSED) continue;

      /*
       * Состав приводим к карточке заказа.
       *
       * Штатные сводятся по идентификатору клинера, разовые — ПО ИМЕНИ:
       * у них нет карточки в базе, и ключа кроме имени не существует.
       * Сводить их тем же способом, что штатных, нельзя: у всех разовых
       * cleanerId равен null, они никогда бы не нашлись среди уже
       * записанных — и каждая синхронизация добавляла бы их заново, пока
       * в выезде не окажется десять «Убайдов».
       */
      const ключ = (m: { cleanerId: string | null; fullName: string }) =>
        m.cleanerId ?? `гость:${m.fullName.trim().toLowerCase()}`;

      const members = this.membersOfDay(team, индекс);
      const wanted = new Set(members.map(ключ));
      const have = new Map(visit.members.map((m) => [ключ(m), m]));
      const toRemove = visit.members.filter((m) => !wanted.has(ключ(m)));
      const toAdd = members.filter((m) => !have.has(ключ(m)));
      if (toRemove.length) {
        await tx.shiftGroupMember.deleteMany({
          where: { id: { in: toRemove.map((m) => m.id) } },
        });
      }
      if (toAdd.length) {
        await tx.shiftGroupMember.createMany({
          data: toAdd.map((m) => ({ ...m, groupId: visit.id })),
        });
      }
      // роль бригадира и сумма разового могли смениться — держим в актуальном виде
      for (const m of members) {
        const cur = have.get(ключ(m));
        if (!cur) continue;
        if (cur.role !== m.role || cur.rate !== m.rate) {
          await tx.shiftGroupMember.update({
            where: { id: cur.id },
            data: { role: m.role, rate: m.rate },
          });
        }
      }
      const data: Prisma.ShiftGroupUncheckedUpdateInput = {
        date: dayUTC(день),
        address: order.address?.trim() || visit.address,
        brigadeId: brigade?.id ?? null,
        brigadeName: brigade?.name ?? null,
        brigadierId: leader?.id ?? null,
        brigadierName: leader?.fullName ?? null,
        managerId: order.managerId ?? visit.managerId,
        managerName: order.manager?.fullName ?? visit.managerName,
        ...(order.preferredTime && !visit.startTime ? { startTime: order.preferredTime } : {}),
      };
      const after = await tx.shiftGroup.update({
        where: { id: visit.id },
        data,
        include: { members: true },
      });
      const was = visit.members.map((m) => m.fullName).join(', ') || '—';
      const now = after.members.map((m) => m.fullName).join(', ') || '—';
      const changes = this.audit.diff(visit as any, after as any, [
        'date',
        'address',
        'brigadeName',
        'brigadierName',
        'managerName',
        'startTime',
      ]);
      if (was !== now) {
        changes.push({ field: 'members', label: 'Состав группы', before: was, after: now });
      }
      if (changes.length) {
        await this.audit.log(tx, {
          user,
          entity: 'SHIFT_GROUP',
          entityId: visit.id,
          entityTitle: this.titleOf(after),
          action: AuditAction.UPDATE,
          summary: 'Обновлён по карточке заказа',
          changes,
        });
        updated += 1;
      }
    }
    // дней стало меньше — лишние АВТОМАТИЧЕСКИЕ открытые выезды в корзину
    for (const extra of existing.slice(дни.length)) {
      if (extra.status === ShiftGroupStatus.CLOSED) continue;
      if (!(extra.note ?? '').startsWith('Создан автоматически')) continue;
      await tx.shift.updateMany({ where: { groupId: extra.id }, data: { groupId: null } });
      await tx.shiftGroup.update({
        where: { id: extra.id },
        data: softDeleteData(user, 'Дней уборки в заказе стало меньше'),
      });
    }
    return { created, updated };
  }

  /**
   * «Оплачено» = смены закрыты (решение владельца): все открытые выезды
   * заказа закрываются, каждому участнику начисляется смена. Возвращает
   * закрытые выезды — вызывающий сообщит руководству одним уведомлением.
   */
  async closeForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    user: AuthUser,
  ): Promise<{ id: string; date: Date; address: string; members: number }[]> {
    const open = await tx.shiftGroup.findMany({
      where: { orderId, ...NOT_DELETED, status: { not: ShiftGroupStatus.CLOSED } },
      include: { members: true },
      orderBy: { date: 'asc' },
    });
    const closed: { id: string; date: Date; address: string; members: number }[] = [];
    for (const group of open) {
      if (group.members.length === 0) {
        throw new BadRequestException(
          'Укажите, кто делал уборку: выберите клинеров в карточке заказа — иначе зарплата не начислится',
        );
      }
      await this.closeInTx(tx, group, user, {});
      closed.push({ id: group.id, date: group.date, address: group.address, members: group.members.length });
    }
    return closed;
  }

  /**
   * Заказ вернули из «Оплачено» (ошиблись этапом): начисленные этим выездом
   * смены снимаются, выезд снова открыт. Повторное «Оплачено» начислит
   * заново — двойной зарплаты не будет. Смены с другого выезда того же дня
   * не трогаем: у них другой groupId.
   */
  async reopenForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    user: AuthUser,
  ): Promise<number> {
    const closedOnes = await tx.shiftGroup.findMany({
      where: { orderId, ...NOT_DELETED, status: ShiftGroupStatus.CLOSED },
      select: { id: true, date: true, address: true },
    });
    for (const g of closedOnes) {
      const removed = await tx.shift.deleteMany({ where: { groupId: g.id } });
      await tx.shiftGroup.update({
        where: { id: g.id },
        data: {
          status: ShiftGroupStatus.IN_PROGRESS,
          closedAt: null,
          closedById: null,
          closedByName: null,
          closedSnapshot: Prisma.DbNull,
        },
      });
      await this.audit.log(tx, {
        user,
        entity: 'SHIFT_GROUP',
        entityId: g.id,
        entityTitle: this.titleOf(g),
        action: AuditAction.UPDATE,
        summary: `Заказ вернули из «Оплачено»: выезд снова открыт, снято смен: ${removed.count}`,
      });
    }
    return closedOnes.length;
  }

  /** Само закрытие — внутри чужой транзакции; слепок, смены, журнал */
  private async closeInTx(
    tx: Prisma.TransactionClient,
    group: {
      id: string;
      date: Date;
      address: string;
      startTime: string | null;
      endTime: string | null;
      brigadeName: string | null;
      brigadierName: string | null;
      managerName: string | null;
      orderId: string | null;
      members: { cleanerId: string | null; fullName: string; role: string; rate: number }[];
    },
    user: AuthUser,
    dto: { endTime?: string; note?: string },
  ) {
    const closedAt = new Date();
    const snapshot = {
      address: group.address,
      date: group.date,
      startTime: group.startTime,
      endTime: dto.endTime ?? group.endTime,
      brigadeName: group.brigadeName,
      brigadierName: group.brigadierName,
      managerName: group.managerName,
      orderId: group.orderId,
      members: group.members.map((m) => ({
        cleanerId: m.cleanerId,
        fullName: m.fullName,
        role: m.role,
        rate: m.rate,
      })),
    };
    // начисляем смены участникам; уже отмеченные за этот день не дублируем
    await tx.shift.createMany({
      data: group.members
        .filter((m): m is typeof m & { cleanerId: string } => !!m.cleanerId)
        .map((m) => ({
          date: group.date,
          cleanerId: m.cleanerId,
          rate: m.rate,
          note: group.address,
          groupId: group.id,
        })),
      skipDuplicates: true,
    });
    const res = await tx.shiftGroup.update({
      where: { id: group.id },
      data: {
        status: ShiftGroupStatus.CLOSED,
        closedAt,
        closedById: user.id,
        closedByName: user.fullName,
        closedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        ...(dto.endTime ? { endTime: dto.endTime } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
      include: groupInclude,
    });
    await this.audit.log(tx, {
      user,
      entity: 'SHIFT_GROUP',
      entityId: group.id,
      entityTitle: this.titleOf(res),
      action: AuditAction.UPDATE,
      summary: `Выезд закрыт; начислено смен: ${res.shifts.length}, состав: ${res.members
        .map((m) => m.fullName)
        .join(', ')}`,
    });
    return res;
  }

  async update(user: AuthUser, id: string, dto: UpdateShiftGroupDto) {
    const before = await this.getOne(id);
    if (before.status === ShiftGroupStatus.CLOSED) {
      throw new BadRequestException(
        'Выезд закрыт: его данные заархивированы и правке не подлежат',
      );
    }

    const data: Prisma.ShiftGroupUncheckedUpdateInput = {};
    if (dto.date !== undefined) data.date = dayUTC(dto.date.slice(0, 10));
    if (dto.address !== undefined) data.address = dto.address.trim();
    if (dto.startTime !== undefined) data.startTime = dto.startTime;
    if (dto.endTime !== undefined) data.endTime = dto.endTime;
    if (dto.note !== undefined) data.note = dto.note || null;
    if (dto.status !== undefined && dto.status !== ShiftGroupStatus.CLOSED) {
      data.status = dto.status;
    }

    if (dto.orderId !== undefined) {
      if (dto.orderId) {
        const order = await this.prisma.order.findFirst({
          where: { id: dto.orderId, ...NOT_DELETED },
          select: { id: true },
        });
        if (!order) throw new NotFoundException('Заказ не найден');
        data.orderId = order.id;
      } else {
        data.orderId = null;
      }
    }

    if (dto.brigadeId !== undefined) {
      const brigade = dto.brigadeId
        ? await this.prisma.brigade.findUnique({ where: { id: dto.brigadeId } })
        : null;
      data.brigadeId = brigade?.id ?? null;
      data.brigadeName = brigade?.name ?? null;
    }
    if (dto.brigadierId !== undefined) {
      const brigadier = dto.brigadierId
        ? await this.prisma.cleaner.findUnique({
            where: { id: dto.brigadierId },
          })
        : null;
      data.brigadierId = brigadier?.id ?? null;
      data.brigadierName = brigadier?.fullName ?? null;
    }
    if (dto.managerId !== undefined) {
      const manager = dto.managerId
        ? await this.prisma.user.findUnique({ where: { id: dto.managerId } })
        : null;
      data.managerId = manager?.id ?? null;
      data.managerName = manager?.fullName ?? null;
    }

    /*
     * Состав задаётся целиком. Если пришли только гости (или только штатные),
     * второй список берём из текущего состава — правка одного не стирает другой.
     */
    const touchingMembers =
      dto.cleanerIds !== undefined || dto.guests !== undefined;
    const members = touchingMembers
      ? [
          ...(dto.cleanerIds !== undefined
            ? await this.resolveMembers(dto.cleanerIds)
            : before.members
                .filter((m) => m.cleanerId)
                .map((m) => ({
                  cleanerId: m.cleanerId,
                  fullName: m.fullName,
                  rate: m.rate,
                  role: m.role,
                }))),
          ...(dto.guests !== undefined
            ? this.guestRows(dto.guests)
            : before.members
                .filter((m) => !m.cleanerId)
                .map((m) => ({
                  cleanerId: null,
                  isGuest: true,
                  fullName: m.fullName,
                  rate: m.rate,
                  role: m.role,
                }))),
        ]
      : null;

    const after = await this.prisma.$transaction(async (tx) => {
      if (members) {
        // состав задаётся целиком: проще и надёжнее, чем вычислять разницу
        await tx.shiftGroupMember.deleteMany({ where: { groupId: id } });
        if (members.length) {
          await tx.shiftGroupMember.createMany({
            data: members.map((m) => ({ ...m, groupId: id })),
          });
        }
      }

      const updated = await tx.shiftGroup.update({
        where: { id },
        data,
        include: groupInclude,
      });

      const changes = this.audit.diff(before as any, updated as any, [
        'date',
        'address',
        'startTime',
        'endTime',
        'brigadeName',
        'brigadierName',
        'managerName',
        'note',
        'status',
        'orderId',
      ]);
      if (members) {
        const was = before.members.map((m) => m.fullName).join(', ') || '—';
        const now = updated.members.map((m) => m.fullName).join(', ') || '—';
        if (was !== now) {
          changes.push({
            field: 'members',
            label: 'Состав группы',
            before: was,
            after: now,
          });
        }
      }

      await this.audit.log(tx, {
        user,
        entity: 'SHIFT_GROUP',
        entityId: id,
        entityTitle: this.titleOf(updated),
        action: AuditAction.UPDATE,
        changes,
      });
      return updated;
    });

    return after;
  }

  /**
   * Закрытие выезда (ТЗ 4): фиксируем адрес, дату, время и состав неизменяемым
   * слепком и начисляем каждому участнику оплачиваемую смену.
   *
   * Смена уникальна по паре «клинер + день», поэтому второй выезд того же
   * человека в тот же день не создаст вторую оплату — это защита от двойного
   * начисления, а не потеря данных: сам выезд сохраняется целиком.
   */
  async close(user: AuthUser, id: string, dto: CloseShiftGroupDto) {
    const group = await this.getOne(id);
    if (group.status === ShiftGroupStatus.CLOSED) {
      throw new BadRequestException('Выезд уже закрыт');
    }
    if (group.members.length === 0) {
      /*
       * Выезд без состава закрыть нельзя — начислять смены некому.
       *
       * Чаще всего сюда попадает выезд, созданный автоматически на этапе
       * «Осмотр объекта»: у заявки с сайта команда ещё не назначена, поэтому
       * состав пустой. Прежний текст «нельзя закрыть без единого участника»
       * не подсказывал, что делать, и человек шёл заводить второй выезд руками.
       */
      throw new BadRequestException(
        'Сначала укажите, кто выезжал: откройте выезд, добавьте клинеров ' +
          'или разовую замену — и после этого закрывайте смену',
      );
    }

    const closed = await this.prisma.$transaction((tx) => this.closeInTx(tx, group, user, dto));
    // уведомление руководству — вне транзакции, чтобы сбой отправки
    // не откатывал закрытие смены
    await this.notifications.notifyDirectors({
      type: 'SHIFT_CLOSED',
      title: 'Смена закрыта',
      message: `${formatDate(closed.date)} · ${closed.address} · ${
        closed.members.length
      } чел.`,
    });

    return closed;
  }

  /** Удаление переносит выезд в корзину (ТЗ 6) */
  async remove(user: AuthUser, id: string, reason?: string) {
    const group = await this.getOne(id);

    await this.prisma.$transaction(async (tx) => {
      // начисленные смены отвязываем, но НЕ удаляем: они уже вошли в выплаты
      await tx.shift.updateMany({
        where: { groupId: id },
        data: { groupId: null },
      });
      await tx.shiftGroup.update({
        where: { id },
        data: softDeleteData(user, reason),
      });

      await this.audit.log(tx, {
        user,
        entity: 'SHIFT_GROUP',
        entityId: id,
        entityTitle: this.titleOf(group),
        action: AuditAction.DELETE,
        summary: reason
          ? `Перенесён в корзину: ${reason}`
          : 'Перенесён в корзину',
      });
    });

    return { ok: true };
  }

  /** История изменений выезда (ТЗ 2) */
  history(id: string) {
    return this.audit.forEntity('SHIFT_GROUP', id);
  }
}
