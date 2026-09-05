import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AuditAction, CleaningType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { slugFromTitle, uniqueKey } from './service-key';
import {
  CreateExtraDto,
  CreateTariffDto,
  UpdateExtraDto,
  UpdateTariffDto,
} from './dto/tariff.dto';

/**
 * Базовые услуги компании. Заводятся один раз при первом запуске.
 * Помечаются isSystem: ключ и единицу измерения у них менять нельзя, удалять нельзя —
 * на них завязаны калькулятор лендинга и все ранее оформленные заказы.
 */
const TARIFF_DEFAULTS: {
  key: string;
  title: string;
  light: number;
  medium: number;
  heavy: number;
  hasLevels: boolean;
  unit: string;
  sortOrder: number;
  /** Минимальная цена и порог: объект меньше порога стоит фиксированно */
  minPrice: number;
  minArea: number;
}[] = [
  {
    key: CleaningType.GENERAL,
    title: 'Генеральная уборка',
    light: 25,
    medium: 27,
    heavy: 29,
    hasLevels: true,
    unit: 'м²',
    sortOrder: 0,
    minPrice: 1500,
    minArea: 50,
  },
  {
    key: CleaningType.POST_RENOVATION,
    title: 'Уборка после ремонта',
    light: 30,
    medium: 32,
    heavy: 35,
    hasLevels: true,
    unit: 'м²',
    sortOrder: 1,
    minPrice: 1500,
    minArea: 50,
  },
  {
    key: CleaningType.FURNITURE,
    title: 'Мойка мягкой мебели',
    light: 70,
    medium: 70,
    heavy: 70,
    hasLevels: false,
    unit: 'место',
    sortOrder: 2,
    // считается местами — под минимум по площади не попадает
    minPrice: 0,
    minArea: 0,
  },
];

/**
 * Доп. услуги, которые сервер заводит сам при первом запуске.
 *
 * Список ПУСТ по решению владельца: «Мытьё окон», «Мытьё холодильника
 * внутри», «Чистка духовки» и «Глажка белья» убраны из справочника
 * (миграция 20260810160000_drop_default_extras). Держать их здесь нельзя —
 * при каждом запуске сервер восстанавливал бы удалённое.
 *
 * Свои доп. услуги владелец заводит сам на странице «Услуги и цены»; они не
 * помечаются базовыми, и удалить их можно оттуда же.
 *
 * Калькулятор на сайте (src/config/pricing.ts) эти опции по-прежнему
 * предлагает — сайт решено не трогать. Заявка с ними принимается, но цена
 * подставляется только по тем услугам, что есть в справочнике.
 */
const EXTRA_DEFAULTS: {
  key: string;
  title: string;
  price: number;
  hasQty: boolean;
  sortOrder: number;
}[] = [];

const SYSTEM_KEYS = TARIFF_DEFAULTS.map((d) => d.key);
const MAX_PRICE = 2_000_000_000;

/**
 * Список работ: без пустых строк и без лишних пробелов.
 *
 * Пункты приходят из текстового поля, где человек переносит строки как ему
 * удобно — пустые строки между абзацами не должны превращаться в пустые
 * пункты сметы.
 */
function cleanWorks(list?: string[]): string[] {
  return (list ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 100);
}

@Injectable()
export class TariffsService implements OnModuleInit {
  private readonly logger = new Logger('Tariffs');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Первичная инициализация: создаём отсутствующие базовые услуги и переносим
   * старые тарифы на цены по степеням загрязнения.
   * Идемпотентно — цены, изменённые директором, не перезаписываются.
   */
  async onModuleInit() {
    try {
      for (const d of TARIFF_DEFAULTS) {
        const existing = await this.prisma.tariff.findUnique({
          where: { key: d.key },
        });

        if (!existing) {
          await this.prisma.tariff.create({
            data: {
              key: d.key,
              title: d.title,
              pricePerSqm: d.medium,
              priceLight: d.light,
              priceMedium: d.medium,
              priceHeavy: d.heavy,
              hasLevels: d.hasLevels,
              unit: d.unit,
              sortOrder: d.sortOrder,
              minPrice: d.minPrice,
              minArea: d.minArea,
              isSystem: true,
            },
          });
          this.logger.log(`Услуга создана: ${d.title}`);
          continue;
        }

        // старая строка без цен по уровням — разовый перенос
        const needsLevels =
          existing.priceLight === 0 &&
          existing.priceMedium === 0 &&
          existing.priceHeavy === 0 &&
          existing.pricePerSqm > 0;

        if (needsLevels || !existing.isSystem) {
          await this.prisma.tariff.update({
            where: { key: d.key },
            data: {
              isSystem: true,
              ...(needsLevels
                ? {
                    title: d.title,
                    pricePerSqm: d.medium,
                    priceLight: d.light,
                    priceMedium: d.medium,
                    priceHeavy: d.heavy,
                    hasLevels: d.hasLevels,
                    unit: d.unit,
                  }
                : {}),
            },
          });
        }
      }

      // «Поддерживающая» как услуга закрыта — прячем, но не удаляем:
      // на неё ссылаются старые заказы, и их история должна читаться
      await this.prisma.tariff.updateMany({
        where: { key: CleaningType.MAINTENANCE },
        data: { isActive: false, isSystem: true },
      });

      // Доп. услуги: создаём только отсутствующие, цены директора не трогаем
      for (const e of EXTRA_DEFAULTS) {
        const existing = await this.prisma.extraService.findUnique({
          where: { key: e.key },
        });
        if (!existing) {
          await this.prisma.extraService.create({
            data: { ...e, isSystem: true },
          });
          this.logger.log(`Доп. услуга создана: ${e.title}`);
        } else if (!existing.isSystem) {
          await this.prisma.extraService.update({
            where: { key: e.key },
            data: { isSystem: true },
          });
        }
      }
    } catch (e) {
      this.logger.error('Инициализация услуг не удалась', e as any);
    }
  }

  private num(v: unknown): number {
    return Math.min(Math.max(0, Math.round(Number(v) || 0)), MAX_PRICE);
  }

  // ─────────────────────── Чтение ───────────────────────

  /**
   * Действующие услуги и доп. услуги.
   * Используется и CRM, и калькулятором лендинга (эндпоинт публичный),
   * поэтому отдаём только активные и неудалённые.
   */
  async getAll() {
    const [tariffs, extras] = await Promise.all([
      this.prisma.tariff.findMany({
        where: { ...NOT_DELETED, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      }),
      this.prisma.extraService.findMany({
        where: { ...NOT_DELETED, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      }),
    ]);
    return { tariffs, extras };
  }

  /** Полный список для управления услугами — вместе со скрытыми */
  async getAllForAdmin() {
    const [tariffs, extras] = await Promise.all([
      this.prisma.tariff.findMany({
        where: NOT_DELETED,
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      }),
      this.prisma.extraService.findMany({
        where: NOT_DELETED,
        orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      }),
    ]);
    return { tariffs, extras };
  }

  // ─────────────────────── Услуги ───────────────────────

  async createTariff(user: AuthUser, dto: CreateTariffDto) {
    /*
     * Ключ генерируется из названия. Явно переданный ключ уважаем — так
     * работают старые интеграции, — но обязательным его больше не считаем.
     */
    const key = dto.key
      ? dto.key.trim().toUpperCase()
      : await uniqueKey(slugFromTitle(dto.title), async (candidate) => {
          const row = await this.prisma.tariff.findUnique({
            where: { key: candidate },
            select: { id: true },
          });
          return !!row;
        });

    const clash = await this.prisma.tariff.findUnique({ where: { key } });
    if (clash) {
      throw new ConflictException(
        clash.deletedAt
          ? 'Услуга с таким названием лежит в корзине — восстановите её или измените название'
          : 'Услуга с таким названием уже есть',
      );
    }

    const hasLevels = dto.hasLevels ?? true;
    const medium = this.num(dto.priceMedium);
    const light = hasLevels ? this.num(dto.priceLight ?? medium) : medium;
    const heavy = hasLevels ? this.num(dto.priceHeavy ?? medium) : medium;

    const created = await this.prisma.tariff.create({
      data: {
        key,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        unit: dto.unit?.trim() || 'м²',
        hasLevels,
        priceLight: light,
        priceMedium: medium,
        priceHeavy: heavy,
        pricePerSqm: medium, // legacy-поле держим равным средней цене
        sortOrder: dto.sortOrder ?? 100,
        isActive: dto.isActive ?? true,
        isSystem: false,
        includedWorks: cleanWorks(dto.includedWorks),
        excludedWorks: cleanWorks(dto.excludedWorks),
        outputPerDay: dto.outputPerDay || null,
        // минимум по объёму: ноль в любом поле — правила нет
        minPrice: this.num(dto.minPrice ?? 0),
        minArea: Math.min(this.num(dto.minArea ?? 0), 100000),
      },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'SERVICE',
      entityId: created.id,
      entityTitle: created.title,
      action: AuditAction.CREATE,
      summary: `Добавлена услуга «${created.title}» (${created.priceMedium} с/${created.unit})`,
    });
    return created;
  }

  async updateTariff(user: AuthUser, key: string, dto: UpdateTariffDto) {
    const before = await this.prisma.tariff.findFirst({
      where: { key, ...NOT_DELETED },
    });
    if (!before) throw new NotFoundException('Услуга не найдена');

    const data: Prisma.TariffUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.includedWorks !== undefined) {
      data.includedWorks = cleanWorks(dto.includedWorks);
    }
    if (dto.excludedWorks !== undefined) {
      data.excludedWorks = cleanWorks(dto.excludedWorks);
    }
    if (dto.outputPerDay !== undefined) {
      data.outputPerDay = dto.outputPerDay || null;
    }
    // минимум по объёму: ноль в любом поле выключает правило
    if (dto.minPrice !== undefined) data.minPrice = this.num(dto.minPrice);
    if (dto.minArea !== undefined) {
      data.minArea = Math.min(this.num(dto.minArea), 100000);
    }

    // У базовой услуги единицу измерения менять нельзя: на неё опирается
    // калькулятор лендинга и расчёт всех прошлых заказов
    if (dto.unit !== undefined) {
      if (before.isSystem && dto.unit.trim() !== before.unit) {
        throw new BadRequestException(
          'У базовой услуги нельзя менять единицу измерения',
        );
      }
      data.unit = dto.unit.trim() || before.unit;
    }
    if (dto.hasLevels !== undefined) data.hasLevels = dto.hasLevels;

    // Частичное обновление цен: не переданные уровни НЕ обнуляем
    const anyLevel =
      dto.priceLight !== undefined ||
      dto.priceMedium !== undefined ||
      dto.priceHeavy !== undefined;

    if (dto.priceLight !== undefined) data.priceLight = this.num(dto.priceLight);
    if (dto.priceMedium !== undefined) {
      data.priceMedium = this.num(dto.priceMedium);
      data.pricePerSqm = this.num(dto.priceMedium);
    }
    if (dto.priceHeavy !== undefined) data.priceHeavy = this.num(dto.priceHeavy);

    // Старый фронтенд шлёт одну цену — раскладываем её на все уровни
    if (!anyLevel && dto.pricePerSqm !== undefined) {
      const v = this.num(dto.pricePerSqm);
      data.priceLight = v;
      data.priceMedium = v;
      data.priceHeavy = v;
      data.pricePerSqm = v;
    }

    const after = await this.prisma.tariff.update({ where: { key }, data });

    await this.audit.log(this.prisma, {
      user,
      entity: 'SERVICE',
      entityId: after.id,
      entityTitle: after.title,
      action: AuditAction.UPDATE,
      changes: this.audit.diff(before, after, [
        'title',
        'description',
        'unit',
        'hasLevels',
        'priceLight',
        'priceMedium',
        'priceHeavy',
        'sortOrder',
        'isActive',
        /*
         * Состав работ и выработка — ради них фича и делалась: правку «что
         * входит в услугу» надо уметь показать в истории. Иначе пункт «мытьё
         * окон» можно тихо убрать задним числом, и спорить с клиентом будет
         * нечем — а именно этот спор список и должен закрывать.
         */
        'includedWorks',
        'excludedWorks',
        'outputPerDay',
        // минимум и порог меняют цену заказов — правка обязана быть в истории
        'minPrice',
        'minArea',
      ]),
    });
    return after;
  }

  async removeTariff(user: AuthUser, key: string, reason?: string) {
    const tariff = await this.prisma.tariff.findFirst({
      where: { key, ...NOT_DELETED },
    });
    if (!tariff) throw new NotFoundException('Услуга не найдена');
    if (tariff.isSystem) {
      throw new BadRequestException(
        'Базовую услугу удалить нельзя — её можно только скрыть',
      );
    }

    // Заказы на удалённую услугу остаются: услуга уходит в корзину,
    // а история заказов продолжает читаться по снапшоту serviceKey
    const used = await this.prisma.order.count({
      where: { serviceKey: key, ...NOT_DELETED },
    });

    const removed = await this.prisma.tariff.update({
      where: { key },
      data: { ...softDeleteData(user, reason), isActive: false },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'SERVICE',
      entityId: removed.id,
      entityTitle: removed.title,
      action: AuditAction.DELETE,
      summary: used
        ? `Услуга перенесена в корзину (использована в ${used} заказах)`
        : 'Услуга перенесена в корзину',
    });
    return { ok: true, ordersAffected: used };
  }

  // ──────────────────── Доп. услуги ────────────────────

  async createExtra(user: AuthUser, dto: CreateExtraDto) {
    // ключ доп. услуги тоже из названия, строчными — как в существующих данных
    const key = dto.key
      ? dto.key.trim().toLowerCase()
      : (
          await uniqueKey(slugFromTitle(dto.title), async (candidate) => {
            const row = await this.prisma.extraService.findUnique({
              where: { key: candidate.toLowerCase() },
              select: { id: true },
            });
            return !!row;
          })
        ).toLowerCase();

    const clash = await this.prisma.extraService.findUnique({ where: { key } });
    if (clash) {
      throw new ConflictException(
        clash.deletedAt
          ? 'Доп. услуга с таким названием лежит в корзине — восстановите её или измените название'
          : 'Доп. услуга с таким названием уже есть',
      );
    }

    const created = await this.prisma.extraService.create({
      data: {
        key,
        title: dto.title.trim(),
        price: this.num(dto.price),
        hasQty: dto.hasQty ?? false,
        sortOrder: dto.sortOrder ?? 100,
        isActive: dto.isActive ?? true,
        isSystem: false,
      },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'SERVICE',
      entityId: created.id,
      entityTitle: created.title,
      action: AuditAction.CREATE,
      summary: `Добавлена доп. услуга «${created.title}» (${created.price} с)`,
    });
    return created;
  }

  async updateExtra(user: AuthUser, key: string, dto: UpdateExtraDto) {
    const before = await this.prisma.extraService.findFirst({
      where: { key, ...NOT_DELETED },
    });
    if (!before) throw new NotFoundException('Доп. услуга не найдена');

    const data: Prisma.ExtraServiceUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.price !== undefined) data.price = this.num(dto.price);
    if (dto.hasQty !== undefined) data.hasQty = dto.hasQty;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const after = await this.prisma.extraService.update({
      where: { key },
      data,
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'SERVICE',
      entityId: after.id,
      entityTitle: after.title,
      action: AuditAction.UPDATE,
      changes: this.audit.diff(before, after, [
        'title',
        'price',
        'hasQty',
        'sortOrder',
        'isActive',
      ]),
    });
    return after;
  }

  async removeExtra(user: AuthUser, key: string, reason?: string) {
    const extra = await this.prisma.extraService.findFirst({
      where: { key, ...NOT_DELETED },
    });
    if (!extra) throw new NotFoundException('Доп. услуга не найдена');
    if (extra.isSystem) {
      throw new BadRequestException(
        'Базовую доп. услугу удалить нельзя — её можно только скрыть',
      );
    }

    const removed = await this.prisma.extraService.update({
      where: { key },
      data: { ...softDeleteData(user, reason), isActive: false },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'SERVICE',
      entityId: removed.id,
      entityTitle: removed.title,
      action: AuditAction.DELETE,
      summary: 'Доп. услуга перенесена в корзину',
    });
    return { ok: true };
  }

  /** История изменений услуги (ТЗ 2) */
  async history(key: string) {
    const tariff = await this.prisma.tariff.findUnique({ where: { key } });
    const extra = tariff
      ? null
      : await this.prisma.extraService.findUnique({ where: { key } });
    const id = tariff?.id ?? extra?.id;
    if (!id) throw new NotFoundException('Услуга не найдена');
    return this.audit.forEntity('SERVICE', id);
  }

  /** Список системных ключей — нужен другим модулям для проверок */
  static get systemKeys(): string[] {
    return SYSTEM_KEYS;
  }
}
