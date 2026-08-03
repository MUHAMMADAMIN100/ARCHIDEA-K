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
import { TelegramService } from '../telegram/telegram.service';
import { escapeHtml } from '../telegram/telegram.util';
import { NOT_DELETED } from '../common/soft-delete';
import { parseDate } from '../common/time/dushanbe';
import { formatPhone, normalizePhone } from '../common/validation/contact';
import { unitPrice } from '../orders/order-pricing';
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
    private telegram: TelegramService,
  ) {}

  /** Приём заявки с лендинга: дедуп клиента, создание заказа, авто-назначение, уведомление */
  async intake(dto: LeadIntakeDto) {
    // 1. Антиспам honeypot
    if (dto.company && dto.company.trim() !== '') {
      this.logger.warn('Honeypot сработал — заявка отклонена');
      return { ok: true }; // тихо игнорируем бота
    }

    /*
     * Обязательные поля заявки проверяем и на сервере, а не только в форме.
     * Форма может быть открыта из кэша старой версии, а заявку можно отправить
     * и минуя её — без адреса и даты менеджеру нечего делать с обращением.
     */
    const missing: string[] = [];
    if (!dto.contact?.name?.trim()) missing.push('имя');
    if (!dto.contact?.phone?.trim()) missing.push('телефон');
    if (!dto.contact?.address?.trim()) missing.push('адрес');
    if (!dto.quiz?.date?.trim()) missing.push('дату уборки');
    if (missing.length) {
      throw new BadRequestException(`Заполните ${missing.join(', ')}`);
    }
    /*
     * Запасной номер НЕОБЯЗАТЕЛЕН (решение владельца).
     *
     * Пока он был обязательным, человек с одним телефоном не мог отправить
     * заявку вовсе — форма его не выпускала. Это прямая потеря заказов ради
     * поля «на всякий случай».
     */
    const contact = {
      name: dto.contact!.name!.trim(),
      phone: dto.contact!.phone!.trim(),
      phone2: dto.contact?.phone2?.trim() || '',
      address: dto.contact!.address!.trim(),
    };

    /*
     * Если запасной номер всё же указали, он должен отличаться от основного:
     * иначе в карточке клиента окажется один и тот же телефон дважды.
     * Совпадение не роняем ошибкой — просто не сохраняем дубль: заявка
     * важнее педантичности.
     */
    const sameAsMain =
      !!contact.phone2 &&
      normalizePhone(contact.phone) === normalizePhone(contact.phone2);
    const extraPhones = contact.phone2 && !sameAsMain ? [contact.phone2] : [];

    // 2. Rate-limit: не чаще раза в 20 сек с одного телефона
    // ключ по каноническому номеру: «+992 90…» и «90…» — один и тот же человек
    const phoneKey = normalizePhone(contact.phone) ?? contact.phone;
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

    /*
     * 3. Кому заявка.
     *
     * Клиент, который уже обращался, возвращается к СВОЕМУ менеджеру мимо
     * очереди: тот знает историю, договорённости и цену прошлой уборки.
     * Новый клиент идёт следующему по очереди.
     */
    const known = await this.prisma.client.findUnique({
      where: { phone: normalizePhone(contact.phone) || contact.phone },
      select: { managerId: true },
    });
    const managerId = known?.managerId ?? (await this.pickManager());

    // 4. Клиент (защита от дублей по телефону)
    const { client } = await this.clients.findOrCreateByPhone({
      fullName: contact.name,
      phone: contact.phone,
      extraPhones,
      source: LeadSource.SITE,
      managerId: managerId ?? undefined,
    });

    // 5. Заказ на этапе «Новая заявка».
    // Числа из заявки клампим в [0, 2e9] — заявка не может задать отрицательную
    // или переполняющую int32 цену/площадь (иначе ошибка БД).
    const clamp = (v: unknown) =>
      Math.min(Math.max(0, Math.round(Number(v) || 0)), 2_000_000_000);
    const cleaningType = TYPE_MAP[dto.calculator?.cleaningTypeId ?? ''] ?? CleaningType.GENERAL;
    const dirtLevel =
      cleaningType === CleaningType.FURNITURE
        ? null
        : DIRT_MAP[dto.calculator?.dirtLevel ?? ''] ?? null;

    /*
     * Цена за единицу берётся из справочника услуг — из того же места, по
     * которому потом пересчитывается заказ.
     *
     * Раньше здесь стояло total/площадь. Но total с сайта УЖЕ включает
     * доп. услуги, поэтому в «цену за м²» попадали окна и духовка: заказ на
     * 120 м² с допами на 330 сомони получал цену 38 с/м² вместо 35. При первой
     * же правке заказа — даже правке одного адреса — сервер брал эти 38 как
     * заданную вручную цену и добавлял доп. услуги ВТОРОЙ раз. Сумма клиента
     * вырастала ровно на стоимость допов, и никто не понимал почему.
     */
    const tariff = await this.prisma.tariff.findFirst({
      where: { key: cleaningType },
      select: {
        key: true,
        unit: true,
        hasLevels: true,
        priceLight: true,
        priceMedium: true,
        priceHeavy: true,
        pricePerSqm: true,
      },
    });
    const perUnit = unitPrice(tariff, dirtLevel) || null;
    /*
     * Дата и время из квиза приходят строками от постороннего сайта. Раньше они
     * шли в new Date() без проверки: «31.02» или мусор превращались в Invalid Date,
     * Prisma падала — и заявка клиента терялась целиком. Теперь неразобранная
     * дата просто не заполняется, а заявка сохраняется.
     */
    const preferred =
      (dto.quiz?.date && dto.quiz?.time
        ? parseDate(`${dto.quiz.date}T${dto.quiz.time}`)
        : null) ?? parseDate(dto.quiz?.date);

    const order = await this.prisma.order.create({
      data: {
        clientId: client.id,
        managerId,
        stage: 'NEW',
        source: LeadSource.SITE,
        cleaningType,
        serviceKey: cleaningType,
        dirtLevel,
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
        pricePerSqm: perUnit,
        address: contact.address,
        preferredDate: preferred,
        preferredTime: dto.quiz?.time,
        /*
         * Дата уборки сразу заполняется тем, что выбрал клиент на сайте.
         * Раньше она оставалась пустой, и менеджер вбивал ту же дату руками,
         * хотя клиент её уже указал. Менеджер может изменить её при
         * согласовании — в поле «Желаемая дата» остаётся исходный выбор клиента.
         */
        scheduledDate: preferred,
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

    /*
     * 6. Уведомление о новой заявке — всем действующим сотрудникам.
     *
     * Раньше его видел только менеджер, которому заявка досталась при
     * распределении: руководитель о новом обращении не знал. Ссылку кладём
     * и на клиента, и на заказ — по клику открывается карточка клиента.
     */
    const volume =
      cleaningType === CleaningType.FURNITURE
        ? `${dto.calculator?.seats ?? 0} мест`
        : `${dto.calculator?.area ?? 0} м²`;
    await this.notifications.notifyEveryone({
      type: NotificationType.NEW_LEAD,
      title: 'Новая заявка с сайта',
      message: `${client.fullName} · ${volume} · ${clamp(dto.total)} сомони${
        managerId ? '' : ' · менеджер не назначен'
      }`,
      orderId: order.id,
      clientId: client.id,
    });

    /*
     * Уведомление в рабочий чат Telegram (ТЗ 10.2). Раньше его слал сам браузер
     * посетителя, из-за чего токен бота лежал в публичном бандле сайта.
     * Теперь сообщение ставится в очередь на сервере: даже если Telegram
     * недоступен, заявка уже сохранена и уйдёт при следующей попытке.
     */
    const lines = [
      '<b>Новая заявка с сайта</b>',
      `Клиент: ${escapeHtml(client.fullName)}`,
      `Телефон: ${escapeHtml(client.phone)}`,
      // запасной номер нужен прямо в уведомлении: по нему звонят вторым
      `Запасной: ${escapeHtml(formatPhone(contact.phone2))}`,
      `Адрес: ${escapeHtml(contact.address)}`,
      `Объём: ${volume}`,
      `Расчёт: ${clamp(dto.total)} сомони`,
      dto.quiz?.comment ? `Комментарий: ${escapeHtml(dto.quiz.comment)}` : null,
    ].filter(Boolean);
    const text = lines.join('\n');
    await this.telegram.enqueueToCompanyChat(text, {
      kind: 'lead',
      refId: order.id,
    });

    /*
     * Личное сообщение тому, кому заявка досталась (решение владельца).
     *
     * Рабочий чат читают все и не сразу; заявка же адресована конкретному
     * человеку, и звонить по ней ему. Если Telegram у него не подключён,
     * заявка всё равно остаётся за ним, а сообщение уходит руководителям —
     * иначе обращение могло бы пролежать незамеченным.
     */
    const assignee = managerId
      ? await this.prisma.user.findUnique({
          where: { id: managerId },
          select: { fullName: true, telegramChatId: true, telegramEnabled: true },
        })
      : null;
    if (assignee?.telegramChatId && assignee.telegramEnabled) {
      await this.telegram.enqueueToUser(
        managerId,
        `${text}\n\n<b>Заявка ваша — позвоните клиенту.</b>`,
        { kind: 'lead-personal', refId: order.id },
      );
    } else {
      const note = assignee
        ? `\n\n<i>У ${escapeHtml(assignee.fullName)} не подключён Telegram — заявка закреплена за ним.</i>`
        : '\n\n<i>Менеджер не назначен: некому распределить заявку.</i>';
      const directors = await this.prisma.user.findMany({
        where: { ...NOT_DELETED, role: Role.DIRECTOR, isActive: true },
        select: { id: true },
      });
      for (const d of directors) {
        await this.telegram.enqueueToUser(d.id, text + note, {
          kind: 'lead-personal',
          refId: order.id,
        });
      }
    }

    this.logger.log(`Новая заявка: ${client.fullName} (${order.id})`);
    return { ok: true, orderId: order.id };
  }

  /**
   * Кому отдать заявку с сайта — по очереди.
   *
   * Раньше выбирался менеджер с наименьшим числом активных заказов. На
   * практике это значило, что все заявки шли одному и тому же: пока он не
   * закроет свои, он же и остаётся самым свободным по счётчику. Решение
   * владельца — ровная очередь: заявка уходит тому, кто получал предыдущую
   * раньше всех, и следующая достанется уже другому.
   *
   * Очередь считаем по самой свежей заявке каждого менеджера — отдельного
   * счётчика в базе не нужно, а порядок остаётся верным и после того, как
   * кого-то отключили от распределения или добавили нового сотрудника.
   */
  private async pickManager(): Promise<string | null> {
    const [managers, groups] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          ...NOT_DELETED,
          role: Role.MANAGER,
          isActive: true,
          acceptsLeads: true,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.order.groupBy({
        by: ['managerId'],
        where: {
          ...NOT_DELETED,
          source: LeadSource.SITE,
          managerId: { not: null },
        },
        _max: { createdAt: true },
      }),
    ]);
    if (managers.length === 0) return null;

    const lastBy = new Map(
      groups.map((g) => [g.managerId, g._max.createdAt?.getTime() ?? 0]),
    );
    let best = managers[0].id;
    let bestAt = Infinity;
    for (const m of managers) {
      // ни одной заявки ещё не получал — его очередь первая
      const at = lastBy.get(m.id) ?? 0;
      if (at < bestAt) {
        bestAt = at;
        best = m.id;
      }
    }
    return best;
  }
}
