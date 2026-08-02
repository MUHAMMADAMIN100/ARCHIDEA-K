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
import { normalizePhone as canonicalPhone } from '../common/validation/contact';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

/**
 * Телефон в едином виде — девять цифр без кода страны.
 *
 * Правило живёт в common/validation/contact, чтобы номер, пришедший с сайта
 * («992900000001»), и тот же номер, вбитый в CRM руками («90 000 00 01»),
 * стали одной и той же строкой. Иначе защита от дублей по телефону
 * не срабатывает и один клиент заводится дважды.
 */
export function normalizePhone(phone: string): string {
  return canonicalPhone(phone) ?? phone.replace(/\D/g, '');
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
    discount?: number;
    extraPhones?: string[];
    labels?: string[];
    sourceDetail?: string;
  }) {
    const phone = canonicalPhone(data.phone);
    if (!phone) {
      throw new BadRequestException(
        'Укажите корректный номер телефона: 9 цифр, например +992 90 000 00 01',
      );
    }
    const fullName = (data.fullName || '').trim().slice(0, 120); // ограничение длины
    const existing = await this.prisma.client.findUnique({ where: { phone } });
    if (existing) {
      if (!existing.deletedAt) {
        const touched = await this.prisma.client.update({
          where: { id: existing.id },
          data: { lastContactAt: new Date() },
        });
        return { client: touched, created: false };
      }

      /*
       * Клиент лежал в корзине и снова обратился — возвращаем его ВМЕСТЕ
       * с историей.
       *
       * Раньше снимался флаг удаления только с самого клиента, а его заказы,
       * КП и напоминания оставались в корзине: карточка открывалась пустой,
       * и вся история продаж по человеку выглядела стёртой. При этом завести
       * его заново нельзя — телефон уникален.
       *
       * Возвращаем только то, что удалили ВМЕСТЕ с ним (тот же штамп времени):
       * заказ, отправленный в корзину отдельно и раньше, должен там и остаться.
       */
      const deletedAt = existing.deletedAt;
      const restore = { deletedAt: null, deletedById: null, deleteReason: null };
      const restored = await this.prisma.$transaction(async (tx) => {
        const client = await tx.client.update({
          where: { id: existing.id },
          data: { ...restore, lastContactAt: new Date() },
        });
        await tx.order.updateMany({ where: { clientId: existing.id, deletedAt }, data: restore });
        await tx.proposal.updateMany({ where: { clientId: existing.id, deletedAt }, data: restore });
        await tx.reminder.updateMany({ where: { clientId: existing.id, deletedAt }, data: restore });
        return client;
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
        discount: data.discount ?? 0,
        // запасные номера храним в едином формате — 9 цифр
        extraPhones: (data.extraPhones ?? [])
          .map((p) => normalizePhone(p))
          .filter((p): p is string => !!p),
        labels: (data.labels ?? []).map((l) => l.trim()).filter(Boolean),
        sourceDetail: data.sourceDetail?.trim() || null,
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
        'discount',
        'sourceDetail',
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
  /**
   * Список всех тегов у клиентов, по алфавиту и без повторов.
   * Область данных та же, что у списка клиентов: менеджер видит теги
   * своих клиентов, руководитель — всех.
   */
  async labels(user: AuthUser): Promise<string[]> {
    const rows = await this.prisma.client.findMany({
      where: seesAll(user)
        ? { ...NOT_DELETED }
        : { ...NOT_DELETED, managerId: user.id },
      select: { labels: true },
    });
    const all = new Set<string>();
    for (const r of rows) for (const l of r.labels) all.add(l);
    return [...all].sort((a, b) => a.localeCompare(b, 'ru'));
  }

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
