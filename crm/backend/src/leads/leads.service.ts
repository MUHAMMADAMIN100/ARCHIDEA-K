import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AccessMethod,
  CleaningType,
  DirtLevel,
  LeadSource,
  NotificationType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadIntakeDto } from './dto/intake.dto';

const TYPE_MAP: Record<string, CleaningType> = {
  maintenance: CleaningType.GENERAL, // услуга закрыта — старые кэши сайта считаем генеральной
  general: CleaningType.GENERAL,
  post_renovation: CleaningType.POST_RENOVATION,
  furniture: CleaningType.FURNITURE,
};

const DIRT_MAP: Record<string, DirtLevel> = {
  light: DirtLevel.LIGHT,
  medium: DirtLevel.MEDIUM,
  heavy: DirtLevel.HEAVY,
};

@Injectable()
export class LeadsService {
  private readonly logger = new Logger('LeadsIntake');
  // простой rate-limit: телефон -> время последней заявки
  private recent = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private clients: ClientsService,
    private notifications: NotificationsService,
  ) {}

  /** Приём заявки с лендинга: дедуп клиента, создание заказа, авто-назначение, уведомление */
  async intake(dto: LeadIntakeDto) {
    // 1. Антиспам honeypot
    if (dto.company && dto.company.trim() !== '') {
      this.logger.warn('Honeypot сработал — заявка отклонена');
      return { ok: true }; // тихо игнорируем бота
    }

    if (!dto.contact?.phone || !dto.contact?.name) {
      throw new BadRequestException('Не указаны имя или телефон');
    }

    // 2. Rate-limit: не чаще раза в 20 сек с одного телефона
    const phoneKey = dto.contact.phone.replace(/\D/g, '');
    const nowMs = Date.now();
    const last = this.recent.get(phoneKey);
    if (last && nowMs - last < 20_000) {
      throw new BadRequestException('Слишком частые заявки, попробуйте позже');
    }
    // оппортунистическая чистка устаревших записей (карта не растёт бесконечно)
    if (this.recent.size > 500) {
      for (const [k, t] of this.recent) {
        if (nowMs - t > 20_000) this.recent.delete(k);
      }
    }
    this.recent.set(phoneKey, nowMs);

    // 3. Выбираем наименее загруженного менеджера
    const managerId = await this.pickManager();

    // 4. Клиент (защита от дублей по телефону)
    const { client } = await this.clients.findOrCreateByPhone({
      fullName: dto.contact.name,
      phone: dto.contact.phone,
      source: LeadSource.SITE,
      managerId: managerId ?? undefined,
    });

    // 5. Заказ на этапе «Новая заявка».
    // Числа из заявки клампим в [0, 2e9] — заявка не может задать отрицательную
    // или переполняющую int32 цену/площадь (иначе ошибка БД).
    const clamp = (v: unknown) =>
      Math.min(Math.max(0, Math.round(Number(v) || 0)), 2_000_000_000);
    const cleaningType = TYPE_MAP[dto.calculator?.cleaningTypeId ?? ''] ?? CleaningType.GENERAL;
    const preferred =
      dto.quiz?.date && dto.quiz?.time
        ? new Date(`${dto.quiz.date}T${dto.quiz.time}`)
        : dto.quiz?.date
          ? new Date(dto.quiz.date)
          : null;

    const order = await this.prisma.order.create({
      data: {
        clientId: client.id,
        managerId,
        stage: 'NEW',
        source: LeadSource.SITE,
        cleaningType,
        dirtLevel:
          cleaningType === CleaningType.FURNITURE
            ? null
            : DIRT_MAP[dto.calculator?.dirtLevel ?? ''] ?? null,
        area:
          cleaningType === CleaningType.FURNITURE
            ? 0
            : clamp(dto.calculator?.area),
        seats:
          cleaningType === CleaningType.FURNITURE
            ? clamp(dto.calculator?.seats)
            : null,
        estimatedPrice: clamp(dto.total),
        // цена за единицу (м² или место) — чтобы было видно, из чего сложилась цена
        pricePerSqm: (() => {
          const total = clamp(dto.total);
          const units =
            cleaningType === CleaningType.FURNITURE
              ? clamp(dto.calculator?.seats)
              : clamp(dto.calculator?.area);
          return units > 0 ? Math.round(total / units) : null;
        })(),
        address: dto.contact.address,
        preferredDate: preferred,
        preferredTime: dto.quiz?.time,
        hasUtilities:
          dto.quiz?.hasUtilities === 'yes'
            ? true
            : dto.quiz?.hasUtilities === 'no'
              ? false
              : null,
        accessMethod:
          dto.quiz?.access === 'keys'
            ? AccessMethod.KEYS
            : dto.quiz?.access === 'onsite'
              ? AccessMethod.ONSITE
              : null,
        comment: dto.quiz?.comment,
        extras:
          cleaningType === CleaningType.FURNITURE
            ? undefined
            : dto.calculator?.extras ?? undefined,
        isLarge: (dto.total ?? 0) >= 2000,
      },
    });

    // 6. Уведомляем назначенного менеджера (или всех руководителей, если менеджеров нет)
    if (managerId) {
      const volume =
        cleaningType === CleaningType.FURNITURE
          ? `${dto.calculator?.seats ?? 0} мест`
          : `${dto.calculator?.area ?? 0} м²`;
      await this.notifications.notify({
        userId: managerId,
        type: NotificationType.NEW_LEAD,
        title: 'Новая заявка с сайта',
        message: `${client.fullName} · ${volume} · ${dto.total ?? 0} сомони`,
        orderId: order.id,
      });
    } else {
      await this.notifications.notifyDirectors({
        type: NotificationType.NEW_LEAD,
        title: 'Новая заявка с сайта (без менеджера)',
        message: `${client.fullName} · ${dto.total ?? 0} сомони`,
        orderId: order.id,
      });
    }

    this.logger.log(`Новая заявка: ${client.fullName} (${order.id})`);
    return { ok: true, orderId: order.id };
  }

  /** Менеджер отдела продаж с наименьшим числом активных заказов */
  private async pickManager(): Promise<string | null> {
    // 2 запроса вместо 1+N: менеджеры + групповой count активных заказов
    const [managers, groups] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: Role.MANAGER, isActive: true, acceptsLeads: true },
        select: { id: true },
      }),
      this.prisma.order.groupBy({
        by: ['managerId'],
        where: { stage: { notIn: ['PAID', 'REJECTED'] }, managerId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    if (managers.length === 0) return null;

    const countBy = new Map(groups.map((g) => [g.managerId, g._count._all]));
    let best = managers[0].id;
    let bestCount = Infinity;
    for (const m of managers) {
      const count = countBy.get(m.id) ?? 0; // менеджера нет в группах = 0 заказов
      if (count < bestCount) {
        bestCount = count;
        best = m.id;
      }
    }
    return best;
  }
}
