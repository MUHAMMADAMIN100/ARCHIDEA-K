import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';
import {
  AuditChange,
  AuditEntity,
  FINANCIAL_ENTITIES,
  MASKED_FIELDS,
  fieldLabel,
} from './audit.types';
import { AuditQueryDto } from './dto/audit-query.dto';

/** Клиент Prisma или транзакция — журнал пишется внутри той же транзакции */
type Db = PrismaService | Prisma.TransactionClient;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private prisma: PrismaService) {}

  /** Приводим значение к строке для журнала, пряча секреты */
  private stringify(field: string, value: unknown): string | null {
    if (MASKED_FIELDS.has(field)) return '***';
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? 'да' : 'нет';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Сравнивает состояние до и после, оставляя только реально изменившиеся поля.
   * Если fields не передан — сравниваются все поля объекта «после».
   */
  diff<T extends Record<string, any>>(
    before: T | null | undefined,
    after: T | null | undefined,
    fields?: (keyof T & string)[],
  ): AuditChange[] {
    if (!after) return [];
    const keys = fields ?? (Object.keys(after) as (keyof T & string)[]);
    const changes: AuditChange[] = [];

    for (const field of keys) {
      const b = this.stringify(field, before?.[field]);
      const a = this.stringify(field, after[field]);
      if (b === a) continue;
      changes.push({ field, label: fieldLabel(field), before: b, after: a });
    }
    return changes;
  }

  /**
   * Запись в журнал. Никогда не роняет основную операцию: если журнал недоступен,
   * бизнес-действие должно завершиться — иначе сломается вся CRM.
   * Внутри транзакции передавайте tx, чтобы запись откатилась вместе с изменением.
   */
  async log(
    db: Db,
    p: {
      user: AuthUser | null;
      entity: AuditEntity;
      entityId: string;
      entityTitle: string;
      action: AuditAction;
      summary?: string | null;
      changes?: AuditChange[];
      ip?: string | null;
    },
  ): Promise<void> {
    // UPDATE без единого изменения писать незачем — только шум в истории
    if (p.action === AuditAction.UPDATE && p.changes && p.changes.length === 0) {
      return;
    }
    try {
      await db.auditLog.create({
        data: {
          entity: p.entity,
          entityId: p.entityId,
          entityTitle: p.entityTitle.slice(0, 300),
          action: p.action,
          summary: p.summary?.slice(0, 500) ?? null,
          changes: p.changes?.length
            ? (p.changes as unknown as Prisma.InputJsonValue)
            : undefined,
          actorId: p.user?.id ?? null,
          actorName: p.user?.fullName ?? 'Система',
          ip: p.ip?.slice(0, 60) ?? null,
        },
      });
    } catch (e) {
      this.logger.error(
        `Не удалось записать в журнал изменений (${p.entity} ${p.entityId})`,
        e as any,
      );
    }
  }

  /**
   * Запись в журнал, которая ОБЯЗАНА состояться.
   *
   * Обычный log() намеренно глотает ошибку: сбой журнала не должен ронять
   * бизнес-операцию. Но для безвозвратного удаления логика обратная — если
   * следа в журнале не осталось, удалять нельзя. Здесь ошибка пробрасывается
   * и откатывает транзакцию вместе с самим удалением.
   */
  async logStrict(
    db: Db,
    p: Parameters<AuditService['log']>[1],
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        entity: p.entity,
        entityId: p.entityId,
        entityTitle: p.entityTitle.slice(0, 300),
        action: p.action,
        summary: p.summary?.slice(0, 500) ?? null,
        changes: p.changes?.length
          ? (p.changes as unknown as Prisma.InputJsonValue)
          : undefined,
        actorId: p.user?.id ?? null,
        actorName: p.user?.fullName ?? 'Система',
        ip: p.ip?.slice(0, 60) ?? null,
      },
    });
  }

  /** История конкретного объекта — вкладка «История» в карточке */
  forEntity(entity: AuditEntity, entityId: string, take = 100) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, MAX_LIMIT),
    });
  }

  /** Общая лента журнала с фильтрами и курсорной постраничной выдачей */
  async list(user: AuthUser, q: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {};

    if (q.entity) where.entity = q.entity;
    if (q.entityId) where.entityId = q.entityId;
    if (q.actorId) where.actorId = q.actorId;
    if (q.action) where.action = q.action;

    // Финансовая история не показывается тем, у кого нет доступа к финансам
    if (!can(user, 'finance:view')) {
      where.entity = q.entity
        ? FINANCIAL_ENTITIES.includes(q.entity as AuditEntity)
          ? '__denied__'
          : q.entity
        : { notIn: FINANCIAL_ENTITIES };
    }

    if (q.from || q.to) {
      const range: Prisma.DateTimeFilter = {};
      if (q.from) range.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) range.lte = new Date(`${q.to}T23:59:59.999Z`);
      where.createdAt = range;
    }

    const search = q.search?.trim();
    if (search) {
      where.OR = [
        { entityTitle: { contains: search, mode: 'insensitive' } },
        { summary: { contains: search, mode: 'insensitive' } },
        { actorName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /** Кто и что менял по конкретному сотруднику (вкладка в карточке сотрудника) */
  byActor(actorId: string, take = 100) {
    return this.prisma.auditLog.findMany({
      where: { actorId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, MAX_LIMIT),
    });
  }
}
