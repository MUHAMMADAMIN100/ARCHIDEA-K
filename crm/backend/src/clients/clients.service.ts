import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ClientTag, LeadSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

/** Нормализуем телефон до цифр (для дедупликации) */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Список с поиском/фильтром/сортировкой. Менеджер видит только своих. */
  async list(
    user: AuthUser,
    q: {
      search?: string;
      tag?: ClientTag;
      source?: LeadSource;
      managerId?: string;
      sort?: 'recent' | 'name';
      /** ТЗ 9.4 — только повторные клиенты */
      repeat?: boolean;
    },
  ) {
    const where: Prisma.ClientWhereInput = { ...NOT_DELETED };
    if (!seesAll(user)) where.managerId = user.id;
    else if (q.managerId) where.managerId = q.managerId;

    if (q.tag) where.tags = { has: q.tag };
    if (q.source) where.source = q.source;
    if (q.repeat) where.isRepeat = true;
    if (q.search) {
      const term = q.search.trim();
      // по телефону ищем ТОЛЬКО если запрос похож на номер (цифры/+/-/()/пробел)
      // — иначе случайная цифра в имени («Иван2», «UTF8») цепляла бы всех,
      // у кого эта цифра есть в телефоне.
      const isPhoneQuery = /^[\d\s+\-()]+$/.test(term);
      const digits = normalizePhone(term);
      where.OR = [
        { fullName: { contains: term, mode: 'insensitive' } },
        ...(isPhoneQuery && digits ? [{ phone: { contains: digits } }] : []),
      ];
    }

    return this.prisma.client.findMany({
      where,
      orderBy:
        q.sort === 'name'
          ? { fullName: 'asc' }
          : { lastContactAt: 'desc' },
      include: {
        manager: { select: { id: true, fullName: true } },
        _count: { select: { orders: true } },
      },
    });
  }

  async getOne(user: AuthUser, id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, ...NOT_DELETED },
      include: {
        manager: { select: { id: true, fullName: true } },
        orders: {
          where: NOT_DELETED,
          orderBy: { createdAt: 'desc' },
          include: {
            cleaners: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    if (!seesAll(user) && client.managerId !== user.id) {
      throw new NotFoundException('Клиент не найден');
    }
    return client;
  }

  /**
   * Защита от дублей: ищем клиента по телефону.
   * Если есть — возвращаем существующего, иначе создаём.
   */
  async findOrCreateByPhone(data: {
    fullName: string;
    phone: string;
    email?: string;
    source?: LeadSource;
    managerId?: string;
    tags?: ClientTag[];
    notes?: string;
  }) {
    const phone = normalizePhone(data.phone);
    // телефон должен содержать хотя бы 5 цифр — иначе «мусорные» номера
    // (пустые/из одних дефисов) схлопывали бы разных клиентов в одного
    if (phone.length < 5) {
      throw new BadRequestException('Укажите корректный номер телефона');
    }
    const fullName = (data.fullName || '').trim().slice(0, 120); // ограничение длины
    const existing = await this.prisma.client.findUnique({ where: { phone } });
    if (existing) {
      // Клиент из корзины возвращается вместе со своей историей: телефон
      // уникален, и заводить дубль на тот же номер нельзя.
      const restored = await this.prisma.client.update({
        where: { id: existing.id },
        data: {
          lastContactAt: new Date(),
          ...(existing.deletedAt
            ? { deletedAt: null, deletedById: null, deleteReason: null }
            : {}),
        },
      });
      return { client: restored, created: false };
    }
    const client = await this.prisma.client.create({
      data: {
        fullName,
        phone,
        email: data.email,
        source: data.source ?? LeadSource.SITE,
        managerId: data.managerId,
        tags: data.tags ?? [],
        notes: data.notes,
      },
    });
    return { client, created: true };
  }

  async create(user: AuthUser, dto: CreateClientDto) {
    const managerId = seesAll(user) ? dto.managerId ?? null : user.id;

    // Защита от IDOR через дедупликацию по телефону: если клиент с таким
    // номером уже закреплён за ДРУГИМ сотрудником, обычный менеджер не должен
    // получить его карточку (ФИО, e-mail, заметки). Раньше findOrCreateByPhone
    // возвращал существующего клиента любому — утечка чужих данных по номеру.
    const phone = normalizePhone(dto.phone || '');
    if (phone.length >= 5 && !seesAll(user)) {
      const existing = await this.prisma.client.findUnique({
        where: { phone },
        select: { managerId: true },
      });
      if (existing && existing.managerId !== user.id) {
        throw new ConflictException(
          'Клиент с таким телефоном уже закреплён за другим сотрудником',
        );
      }
    }

    const res = await this.findOrCreateByPhone({
      ...dto,
      managerId: managerId ?? undefined,
      source: dto.source ?? LeadSource.CALL,
    });
    return res.client;
  }

  async update(user: AuthUser, id: string, dto: UpdateClientDto) {
    const before = await this.getOne(user, id); // проверка доступа
    const data: Prisma.ClientUpdateInput = { ...dto } as any;
    // переназначать менеджера может только тот, кто видит всю компанию
    if (!seesAll(user)) delete (data as any).managerId;
    if (dto.phone) (data as any).phone = normalizePhone(dto.phone);

    const after = await this.prisma.client.update({ where: { id }, data });

    await this.audit.log(this.prisma, {
      user,
      entity: 'CLIENT',
      entityId: id,
      entityTitle: after.fullName,
      action: AuditAction.UPDATE,
      changes: this.audit.diff(before as any, after as any, [
        'fullName',
        'phone',
        'email',
        'source',
        'tags',
        'notes',
        'preferences',
        'managerId',
      ]),
    });
    return after;
  }

  async touch(id: string) {
    return this.prisma.client.update({
      where: { id },
      data: { lastContactAt: new Date() },
    });
  }

  /**
   * Удаление переносит клиента в корзину (ТЗ 6) вместе с его заказами,
   * коммерческими предложениями и напоминаниями. Физического удаления здесь
   * больше нет: раньше каскад безвозвратно стирал всю историю заказов клиента,
   * то есть и выручку по ним.
   */
  async remove(user: AuthUser, id: string, reason?: string) {
    const client = await this.getOne(user, id); // проверка доступа

    await this.prisma.$transaction(async (tx) => {
      const stamp = softDeleteData(user, reason);
      await tx.client.update({ where: { id }, data: stamp });
      await tx.order.updateMany({
        where: { clientId: id, ...NOT_DELETED },
        data: stamp,
      });
      await tx.proposal.updateMany({
        where: { clientId: id, ...NOT_DELETED },
        data: stamp,
      });
      await tx.reminder.updateMany({
        where: { clientId: id, ...NOT_DELETED },
        data: stamp,
      });

      await this.audit.log(tx, {
        user,
        entity: 'CLIENT',
        entityId: id,
        entityTitle: client.fullName,
        action: AuditAction.DELETE,
        summary: `Перенесён в корзину вместе с заказами (${client.orders.length})`,
      });
    });

    return { ok: true };
  }

  /** История изменений клиента (ТЗ 2) */
  async history(user: AuthUser, id: string) {
    await this.getOne(user, id);
    return this.audit.forEntity('CLIENT', id);
  }

  /** Экспорт в CSV */
  async exportCsv(user: AuthUser): Promise<string> {
    const where: Prisma.ClientWhereInput = seesAll(user)
      ? { ...NOT_DELETED }
      : { ...NOT_DELETED, managerId: user.id };
    const clients = await this.prisma.client.findMany({
      where,
      include: {
        manager: { select: { fullName: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Экранирование поля CSV + защита от формула-инъекции (CWE-1236):
    // ведущие = + - @ (и таб/CR) обезвреживаем апострофом, всё оборачиваем в кавычки.
    const cell = (v: unknown): string => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = [
      'ФИО',
      'Телефон',
      'Источник',
      'Теги',
      'Менеджер',
      'Заказов',
      'Последний контакт',
    ]
      .map(cell)
      .join(';');
    const rows = clients.map((c) =>
      [
        c.fullName,
        c.phone,
        c.source,
        c.tags.join('|'),
        c.manager?.fullName ?? '—',
        c._count.orders,
        c.lastContactAt.toISOString().slice(0, 10),
      ]
        .map(cell)
        .join(';'),
    );
    return [header, ...rows].join('\n');
  }
}
