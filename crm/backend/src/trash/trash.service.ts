import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, seesAll } from '../common/decorators/current-user.decorator';
import { seesFinance } from '../common/permissions';
import { restoreData, softDeleteData } from '../common/soft-delete';
import { momentRange } from '../common/time/dushanbe';
import {
  TRASH_REGISTRY,
  TRASH_TYPES,
  TrashDb,
  TrashEntry,
  TrashType,
} from './trash.registry';
import { TrashListQueryDto } from './dto/trash-query.dto';

/**
 * P2025 — Prisma не нашла запись для update/delete. Возникает при гонке:
 * запись успели удалить между проверкой и самим удалением. Для клиента это
 * «не найдено» (404), а не внутренняя ошибка сервера.
 */
function isRecordNotFound(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025'
  );
}

/** По сколько записей каждого типа показывать в общем виде корзины (без фильтра type) */
const MIXED_VIEW_TAKE = 20;
/** По ТЗ записи корзины живут 45 дней, затем стираются автоматически */
const DEFAULT_RETENTION_DAYS = 45;

/** Заведомо несуществующий id — способ вернуть «ничего» без отдельной ветки запроса */
const NOTHING = '__forbidden__';

export interface TrashItem {
  type: TrashType;
  id: string;
  title: string;
  subtitle: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
  /** Дата, после которой запись попадёт под автоочистку */
  purgeAt: Date | null;
}

@Injectable()
export class TrashService {
  private readonly logger = new Logger('Trash');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Сколько дней хранить удалённое до автоочистки (ТЗ 6) */
  retentionDays(): number {
    const raw = Number(process.env.TRASH_RETENTION_DAYS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RETENTION_DAYS;
  }

  private purgeAt(deletedAt: Date | null): Date | null {
    if (!deletedAt) return null;
    const d = new Date(deletedAt);
    d.setUTCDate(d.getUTCDate() + this.retentionDays());
    return d;
  }

  /**
   * Полиморфный доступ к делегату модели. Имя типа корзины НАМЕРЕННО совпадает
   * с именем свойства PrismaClient (financeEntry, shiftGroup…) — это единственное
   * место в проекте, где разные модели трогаются по имени из переменной, и без
   * `any` здесь не обойтись: типобезопасной общей сигнатуры для 13 разных
   * Prisma-делегатов не существует.
   */
  private delegate(db: TrashDb, type: TrashType): any {
    return (db as any)[type];
  }

  private entry(type: TrashType): TrashEntry {
    return TRASH_REGISTRY[type];
  }

  /**
   * Денежные разделы корзины — ведомости, финансовые записи, премии —
   * видит только тот, кому открыты деньги компании.
   *
   * Раньше правилом было «скрыть от ops-менеджера», и руководитель с личной
   * галочкой «без доступа к финансам» находил в корзине и удалённые
   * ведомости, и записи книги доходов: запрет обходился через корзину.
   */
  private canSeeType(user: AuthUser, type: TrashType): boolean {
    return !(this.entry(type).financial && !seesFinance(user));
  }

  /** Видимые для пользователя разделы корзины (финансовые скрыты от ops) */
  private visibleTypes(user: AuthUser): TrashType[] {
    return TRASH_TYPES.filter((t) => this.canSeeType(user, t));
  }

  /**
   * where-фрагмент видимости строки: директор/ops видят всё (кроме финансов
   * для ops), обычный менеджер — только «своё» (managerId/createdById/…)
   * ИЛИ то, что удалил лично он сам.
   */
  private scopeWhere(user: AuthUser, type: TrashType): Record<string, unknown> {
    if (!this.canSeeType(user, type)) return { id: NOTHING };
    if (seesAll(user)) return {};
    const owner = this.entry(type).ownerWhere?.(user.id);
    return owner ? { OR: [owner, { deletedById: user.id }] } : { deletedById: user.id };
  }

  private listWhere(
    user: AuthUser,
    type: TrashType,
    q: Pick<TrashListQueryDto, 'search' | 'from' | 'to'>,
  ): Record<string, unknown> {
    const range = momentRange(q.from, q.to);
    const where: Record<string, unknown> = {
      deletedAt: { not: null, ...range },
      ...this.scopeWhere(user, type),
    };
    const term = q.search?.trim();
    if (term) where.AND = [this.entry(type).search(term)];
    return where;
  }

  /** Бейдж в меню: сколько записей в каждом разделе корзины видит пользователь */
  async counts(user: AuthUser): Promise<Record<TrashType, number> & { total: number }> {
    const pairs = await Promise.all(
      TRASH_TYPES.map(async (type) => {
        if (!this.canSeeType(user, type)) return [type, 0] as const;
        const where = this.listWhere(user, type, {});
        const n = await this.delegate(this.prisma, type).count({ where });
        return [type, n] as const;
      }),
    );
    const counts = Object.fromEntries(pairs) as Record<TrashType, number>;
    const total = pairs.reduce((sum, [, n]) => sum + n, 0);
    return { ...counts, total };
  }

  /** Определить имена удаливших пользователей одним запросом (без FK-снапшота) */
  private async resolveDeleterNames(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private toItem(type: TrashType, row: any, names: Map<string, string>): TrashItem {
    const entry = this.entry(type);
    return {
      type,
      id: row.id,
      title: entry.title(row),
      subtitle: entry.subtitle(row),
      deletedAt: row.deletedAt ?? null,
      deletedBy: row.deletedById ? names.get(row.deletedById) ?? null : null,
      deleteReason: row.deleteReason ?? null,
      purgeAt: this.purgeAt(row.deletedAt ?? null),
    };
  }

  /** GET /trash — список удалённого с фильтрами и постраничной выдачей */
  async list(user: AuthUser, q: TrashListQueryDto): Promise<{ rows: TrashItem[]; total: number }> {
    const types = q.type ? [q.type] : this.visibleTypes(user);
    const take = q.type ? q.take ?? MIXED_VIEW_TAKE : MIXED_VIEW_TAKE;
    const skip = q.type ? q.skip ?? 0 : 0;

    const perType = await Promise.all(
      types.map(async (type) => {
        const entry = this.entry(type);
        const where = this.listWhere(user, type, q);
        const delegate = this.delegate(this.prisma, type);
        const [rows, total] = await Promise.all([
          delegate.findMany({
            where,
            include: entry.include,
            orderBy: { deletedAt: 'desc' },
            take,
            skip,
          }),
          delegate.count({ where }),
        ]);
        return { type, rows, total };
      }),
    );

    const names = await this.resolveDeleterNames(
      perType.flatMap((p) => p.rows.map((r: any) => r.deletedById)),
    );

    const rows: TrashItem[] = [];
    for (const { type, rows: typeRows } of perType) {
      for (const row of typeRows) rows.push(this.toItem(type, row, names));
    }

    if (!q.type) {
      // сводный вид без фильтра type — единая лента, отсортированная по дате удаления
      rows.sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0));
    }

    const total = q.type ? perType[0]?.total ?? 0 : rows.length;
    return { rows, total };
  }

  /**
   * Перевод записи в корзину. Используется ВСЕМИ остальными сервисами вместо
   * прямого `prisma.<model>.delete(...)`. Проверку прав на само действие
   * (может ли ЭТОТ пользователь удалить ИМЕННО ЭТУ запись) делает вызывающий
   * сервис — здесь только сама операция плюс мягкий каскад и журнал.
   */
  async softDelete(user: AuthUser, type: TrashType, id: string, reason?: string) {
    const entry = this.entry(type);
    return this.prisma.$transaction(async (tx) => {
      const delegate = this.delegate(tx, type);
      const row = await delegate.findFirst({
        where: { id, deletedAt: null },
        include: entry.include,
      });
      if (!row) throw new NotFoundException(`${entry.label} не найден(а)`);

      const data = softDeleteData(user, reason);
      const updated = await delegate.update({ where: { id }, data, include: entry.include });

      if (entry.cascade) {
        for (const rule of entry.cascade) {
          await this.delegate(tx, rule.type).updateMany({
            where: { ...(rule.where?.(id) ?? { [rule.fk]: id }), deletedAt: null },
            data,
          });
        }
      }

      await this.audit.log(tx, {
        user,
        entity: entry.entity,
        entityId: id,
        entityTitle: entry.title(row),
        action: AuditAction.DELETE,
        summary: reason ? `Перемещено в корзину: ${reason}` : 'Перемещено в корзину',
      });

      return updated;
    });
  }

  /** Преобразует конфликт уникальности при восстановлении в понятный 409 */
  private conflictOnRestore(type: TrashType, e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const reasons: Partial<Record<TrashType, string>> = {
        client: 'Клиент с таким телефоном уже существует',
        user: 'Сотрудник с таким логином уже существует',
        tariff: 'Услуга с таким ключом уже существует',
        extraService: 'Доп. услуга с таким ключом уже существует',
      };
      throw new ConflictException(
        reasons[type] ?? 'Восстановлению мешает конфликт уникальных значений',
      );
    }
    throw e;
  }

  /** POST /trash/:type/:id/restore */
  async restore(user: AuthUser, type: TrashType, id: string) {
    const entry = this.entry(type);
    if (!this.canSeeType(user, type)) {
      throw new ForbiddenException('Нет доступа к этому разделу корзины');
    }

    return this.prisma.$transaction(async (tx) => {
      const delegate = this.delegate(tx, type);
      const where = { id, deletedAt: { not: null }, ...this.scopeWhere(user, type) };
      const row = await delegate.findFirst({ where, include: entry.include });
      if (!row) throw new NotFoundException(`${entry.label} не найден(а) в корзине`);

      const deletedAt = row.deletedAt as Date;
      let restored: any;
      try {
        restored = await delegate.update({
          where: { id },
          // restoreExtra: удаление гасит isActive — возвращаем видимость
          data: { ...restoreData, ...(entry.restoreExtra ?? {}) },
          include: entry.include,
        });
      } catch (e) {
        // запись успели очистить безвозвратно между поиском и восстановлением
        if (isRecordNotFound(e)) {
          throw new NotFoundException(`${entry.label} уже удалён(а) безвозвратно`);
        }
        this.conflictOnRestore(type, e);
      }

      if (entry.cascade) {
        // снимаем deletedAt только у детей, удалённых ВМЕСТЕ с родителем —
        // иначе восстановится и то, что было отдельно удалено раньше
        for (const rule of entry.cascade) {
          await this.delegate(tx, rule.type).updateMany({
            where: { ...(rule.where?.(id) ?? { [rule.fk]: id }), deletedAt },
            data: restoreData,
          });
        }
      }

      await this.audit.log(tx, {
        user,
        entity: entry.entity,
        entityId: id,
        entityTitle: entry.title(row),
        action: AuditAction.RESTORE,
        summary: `${entry.label} восстановлен(а) из корзины`,
      });

      return { ok: true as const, type, id };
    });
  }

  /** DELETE /trash/:type/:id — безвозвратное удаление одной записи (только директор) */
  async purge(user: AuthUser, type: TrashType, id: string) {
    const entry = this.entry(type);
    const where = { id, deletedAt: { not: null } };
    const row = await this.delegate(this.prisma, type).findFirst({ where, include: entry.include });
    if (!row) throw new NotFoundException(`${entry.label} не найден(а) в корзине`);

    // Журнал, проверка и само удаление — одной транзакцией: если purgeGuard
    // запрещает удаление или delete падает по FK, откатывается и запись в журнале.
    return this.prisma.$transaction(async (tx) => {
      if (entry.purgeGuard) await entry.purgeGuard(tx, id);

      // logStrict, а не log: обычная запись глушит свои ошибки, и без следа
      // в журнале удаление всё равно бы состоялось. Здесь сбой журнала
      // откатывает транзакцию вместе с удалением.
      await this.audit.logStrict(tx, {
        user,
        entity: entry.entity,
        entityId: id,
        entityTitle: entry.title(row),
        action: AuditAction.PURGE,
        summary: `${entry.label} удалён(а) безвозвратно`,
      });

      try {
        await this.delegate(tx, type).delete({ where: { id } });
      } catch (e) {
        // запись успели удалить параллельно (двойной клик, ночная очистка) —
        // это «не найдено», а не внутренняя ошибка
        if (isRecordNotFound(e)) {
          throw new NotFoundException(`${entry.label} уже удалён(а)`);
        }
        throw e;
      }

      return { ok: true as const };
    });
  }

  /** DELETE /trash?type&olderThanDays&confirm=true — массовая очистка по требованию директора */
  async purgeMany(
    user: AuthUser,
    q: { type?: TrashType; olderThanDays?: number; confirm?: string },
  ) {
    if (q.confirm !== 'true') {
      throw new BadRequestException('Подтвердите очистку параметром confirm=true');
    }
    return this.runPurge(user, q.type, q.olderThanDays);
  }

  /** Автоочистка по расписанию (trash.cleanup.ts) — действует от имени системы */
  async purgeExpired(retentionDays: number) {
    return this.runPurge(null, undefined, retentionDays);
  }

  private async runPurge(
    user: AuthUser | null,
    onlyType: TrashType | undefined,
    olderThanDays: number | undefined,
  ) {
    const types = onlyType ? [onlyType] : TRASH_TYPES;
    const cutoff =
      olderThanDays !== undefined
        ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
        : undefined;

    const deleted = {} as Record<TrashType, number>;
    let total = 0;

    for (const type of types) {
      const entry = this.entry(type);
      const where: Record<string, unknown> = {
        deletedAt: cutoff ? { not: null, lte: cutoff } : { not: null },
      };
      const rows = await this.delegate(this.prisma, type).findMany({
        where,
        include: entry.include,
      });

      let count = 0;
      for (const row of rows) {
        try {
          // своя транзакция на КАЖДУЮ запись: одна не прошедшая проверку или
          // упавшая по FK не должна откатывать уже успешно очищенные записи
          await this.prisma.$transaction(async (tx) => {
            if (entry.purgeGuard) await entry.purgeGuard(tx, row.id);
            await this.audit.log(tx, {
              user,
              entity: entry.entity,
              entityId: row.id,
              entityTitle: entry.title(row),
              action: AuditAction.PURGE,
              summary: `${entry.label} удалён(а) безвозвратно (автоочистка корзины)`,
            });
            await this.delegate(tx, type).delete({ where: { id: row.id } });
          });
          count++;
        } catch (e) {
          // запись не прошла проверку безопасности — пропускаем, не прерывая всю очистку
          this.logger.warn(
            `Пропущена автоочистка ${entry.label} ${row.id}: ${(e as Error).message}`,
          );
        }
      }
      deleted[type] = count;
      total += count;
    }

    return { deleted, total };
  }
}
