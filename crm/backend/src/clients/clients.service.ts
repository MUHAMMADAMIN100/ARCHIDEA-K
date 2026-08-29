import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ClientTag, LeadSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TelegramService } from '../telegram/telegram.service';
import { buildCrmClientMessage } from '../telegram/crm-client-message';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { momentRange } from '../common/time/dushanbe';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { resolveManager } from '../common/resolve-manager';
import { normalizePhone as canonicalPhone } from '../common/validation/contact';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

/**
 * Телефон в едином виде — код страны и номер подряд, только цифры.
 *
 * Правило живёт в common/validation/contact, чтобы номер, пришедший с сайта
 * («992900000001»), и тот же номер, вбитый в CRM руками («90 000 00 01»),
 * стали одной и той же строкой. Иначе защита от дублей по телефону
 * не срабатывает и один клиент заводится дважды.
 */
export function normalizePhone(phone: string): string {
  return canonicalPhone(phone) ?? phone.replace(/\D/g, '');
}

/**
 * Степени заинтересованности, которые есть в системе с самого начала.
 * Остальные менеджеры добавляют сами — кнопкой «+ свой» в карточке клиента.
 */
export const DEFAULT_INTEREST_LEVELS = ['Перезвоню', 'Подумаю', 'Посоветуюсь'];

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private telegram: TelegramService,
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
      /** Период по дате появления клиента в базе, «ГГГГ-ММ-ДД» */
      from?: string;
      to?: string;
    },
  ) {
    const where: Prisma.ClientWhereInput = { ...NOT_DELETED };
    // период — по дате появления клиента в базе (когда его завели)
    if (q.from || q.to) where.createdAt = momentRange(q.from, q.to);
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
      /*
       * По телефону ищем сырыми цифрами, а не приведённым номером.
       *
       * Номер хранится вместе с кодом страны, и «900000001» — это кусок
       * «992900000001». Приводи мы запрос к каноническому виду, поиск по
       * части номера («9161234») перестал бы работать: короткий обрывок
       * телефоном не считается и превращался бы в null.
       */
      const digits = term.replace(/\D/g, '');
      where.OR = [
        { fullName: { contains: term, mode: 'insensitive' } },
        ...(isPhoneQuery && digits.length >= 3
          ? [{ phone: { contains: digits } }]
          : []),
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
        // встречи и звонки, назначенные по этому клиенту
        tasks: {
          where: NOT_DELETED,
          orderBy: { deadline: 'asc' },
          take: 50,
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            deadline: true,
            assignee: { select: { id: true, fullName: true } },
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
    sourceDetail?: string;
    address?: string;
  }) {
    const phone = canonicalPhone(data.phone);
    if (!phone) {
      throw new BadRequestException(
        'Укажите корректный номер телефона: для Таджикистана 9 цифр ' +
          '(+992 90 000 00 01), для другой страны — с её кодом (+7 916 123 45 67)',
      );
    }
    const fullName = (data.fullName || '').trim().slice(0, 120); // ограничение длины

    /*
     * Запасные номера из обращения — в едином виде и без основного:
     * один и тот же телефон не должен лежать в карточке дважды.
     */
    const incomingExtra = (data.extraPhones ?? [])
      .map((p) => canonicalPhone(p))
      .filter((p): p is string => !!p && p !== phone);

    /**
     * Добавляет новые запасные номера к уже сохранённым.
     *
     * Нужно именно дополнение, а не замена: у постоянного клиента в карточке
     * уже могут быть номера, вписанные менеджером руками, и обращение с сайта
     * не должно их стирать.
     */
    const mergeExtra = (saved: string[]): string[] => {
      const out = [...saved];
      for (const p of incomingExtra) if (!out.includes(p)) out.push(p);
      return out;
    };

    const existing = await this.prisma.client.findUnique({ where: { phone } });
    if (existing) {
      if (!existing.deletedAt) {
        /*
         * Клиент обратился повторно и назвал новый запасной номер — раньше
         * он терялся: у существующего клиента обновлялась только дата
         * последнего контакта. Теперь номер дописывается в карточку.
         */
        const touched = await this.prisma.client.update({
          where: { id: existing.id },
          data: {
            lastContactAt: new Date(),
            extraPhones: mergeExtra(existing.extraPhones),
            // адрес дописываем, только если его ещё не было: правки менеджера
            // в карточке важнее того, что назвали при повторном обращении
            ...(existing.address || !data.address?.trim()
              ? {}
              : { address: data.address.trim() }),
          },
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
          data: {
            ...restore,
            lastContactAt: new Date(),
            extraPhones: mergeExtra(existing.extraPhones),
          },
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
        extraPhones: incomingExtra,
        sourceDetail: data.sourceDetail?.trim() || null,
        address: data.address?.trim() || null,
      },
    });
    return { client, created: true };
  }

  async create(user: AuthUser, dto: CreateClientDto) {
    /*
     * Ответственного назначает любой сотрудник, а не только руководитель.
     *
     * Раньше здесь стояло `seesAll(user) ? dto.managerId : user.id`: менеджер
     * не мог передать клиента коллеге вообще — сервер молча ставил создателя,
     * даже если в форме выбрали другого. Теперь выбор уважается, а если его
     * не сделали, ответственным становится тот, кто заводит клиента.
     *
     * Назначить можно только действующего сотрудника: иначе клиент повисал бы
     * на уволенном, и его заявки никто бы не вёл.
     */
    const managerId = await resolveManager(this.prisma, user, dto.managerId);

    /*
     * Один номер — один клиент.
     *
     * Раньше форма «Новый клиент» с уже известным номером молча заводила
     * ЗАЯВКУ на существующего клиента, и в воронке появлялась вторая карточка
     * с тем же именем и телефоном. Теперь сохранение отклоняется, а в ответе
     * названо, кто это и чей: менеджер сразу видит, что клиент в базе, и
     * открывает его карточку вместо создания двойника.
     *
     * Это же закрывает утечку по номеру: карточка чужого клиента (ФИО,
     * заметки) обычному менеджеру не возвращается — только имя и
     * ответственный, чтобы он понимал, к кому идти.
     */
    const phone = normalizePhone(dto.phone || '');
    if (phone.length >= 5) {
      const existing = await this.prisma.client.findUnique({
        where: { phone },
        select: {
          fullName: true,
          deletedAt: true,
          manager: { select: { fullName: true } },
        },
      });
      if (existing?.deletedAt) {
        throw new ConflictException(
          `Клиент с этим номером в корзине — «${existing.fullName}». Восстановите его, а не заводите заново`,
        );
      }
      if (existing) {
        const owner = existing.manager?.fullName;
        throw new ConflictException(
          `Клиент с этим номером уже есть — «${existing.fullName}»` +
            (owner ? `, ответственный ${owner}` : '') +
            '. Новую заявку заведите из его карточки',
        );
      }
    }

    const res = await this.findOrCreateByPhone({
      ...dto,
      managerId: managerId ?? undefined,
      source: dto.source ?? LeadSource.CALL,
    });

    /*
     * Сотрудник добавил клиента — личное сообщение в Telegram каждому,
     * кто привязал бот (решение владельца). Если следом создаётся заявка
     * (withOrder), молчим: уведомление одним сообщением со всеми данными
     * отправит создание заказа, иначе о том же событии пришло бы два.
     */
    if (!dto.withOrder) {
      const manager = managerId
        ? await this.prisma.user.findUnique({
            where: { id: managerId },
            select: { fullName: true },
          })
        : null;
      await this.telegram.enqueueToAllLinked(
        buildCrmClientMessage({
          addedBy: user.fullName,
          client: {
            fullName: res.client.fullName,
            phone: res.client.phone,
            extraPhones: dto.extraPhones,
            address: dto.address,
            source: dto.source ?? LeadSource.CALL,
            sourceDetail: dto.sourceDetail,
            tags: dto.tags,
          },
          managerName: manager?.fullName ?? null,
        }),
        { kind: 'crm-client', refId: res.client.id },
      );
    }
    return res.client;
  }

  async update(user: AuthUser, id: string, dto: UpdateClientDto) {
    const before = await this.getOne(user, id); // проверка доступа
    const data: Prisma.ClientUpdateInput = { ...dto } as any;
    // переназначать менеджера может только тот, кто видит всю компанию
    if (!seesAll(user)) delete (data as any).managerId;
    if (dto.phone) (data as any).phone = normalizePhone(dto.phone);

    /*
     * Холодные звонки. Пустое значение означает «снять»: менеджер должен
     * мочь отменить ошибочно поставленный перезвон или стереть степень
     * заинтересованности, а не только заменить их другими.
     */
    if (dto.interestLevel !== undefined) {
      (data as any).interestLevel = dto.interestLevel?.trim() || null;
    }
    if (dto.callbackAt !== undefined) {
      (data as any).callbackAt = dto.callbackAt ? new Date(dto.callbackAt) : null;
    }
    if (dto.callType !== undefined) {
      (data as any).callType = dto.callType ?? null;
    }
    /*
     * Отметили тип разговора или назначили перезвон — значит, с клиентом
     * только что работали. Двигаем дату последнего контакта: по ней KPI
     * считает звонки за период, и без этого «сколько звонили за месяц»
     * оставалось бы нулём.
     */
    if (dto.callType !== undefined || dto.callbackAt !== undefined) {
      (data as any).lastContactAt = new Date();
    }

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
        'callType',
        'callbackAt',
        'interestLevel',
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

      /*
       * Вслед за заказами клиента уходит и всё, что к ним привязано:
       * выезды, ведомости и записи о доходе.
       *
       * Без этого удаление клиента уносило заказы, а их выезды продолжали
       * начислять людям смены в «ЗП клинеров» и в аналитике, доход оставался
       * в книге, а ведомости висели по несуществующим заказам. Само по себе
       * удаление заказа это уже делает — но здесь заказы гасятся напрямую,
       * минуя его, поэтому правило нужно повторить.
       */
      const заказыКлиента = client.orders.map((o) => o.id);
      if (заказыКлиента.length) {
        const где = { orderId: { in: заказыКлиента }, ...NOT_DELETED };
        await tx.shiftGroup.updateMany({ where: где, data: stamp });
        await tx.report.updateMany({ where: где, data: stamp });
        await tx.financeEntry.updateMany({ where: где, data: stamp });
      }

      /*
       * Уведомления про этого клиента и его заказы убираем совсем.
       *
       * Уведомление — это ссылка «перейти и разобраться». После удаления
       * переходить некуда: карточка отвечает «не найдено», и человек видел
       * «Не удалось загрузить данные. Проверьте интернет» — сообщение, не
       * имеющее к происходящему никакого отношения. В корзину их не кладём:
       * это оповещения, а не данные компании.
       */
      await tx.notification.deleteMany({
        where: {
          OR: [
            { clientId: id },
            { orderId: { in: client.orders.map((o) => o.id) } },
          ],
        },
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
   * Варианты степени заинтересованности.
   *
   * Справочника-таблицы нет намеренно: варианты — это три предустановленных
   * плюс всё, что менеджеры уже вписали сами. Так же устроены теги клиента,
   * и заводить ради трёх строк отдельный раздел с правами доступа незачем.
   *
   * Список общий на всю компанию: добавил один менеджер — предлагается всем,
   * иначе одно и то же состояние называлось бы у каждого по-своему и не
   * собиралось бы в отчёт.
   */
  async interestLevels(): Promise<string[]> {
    const rows = await this.prisma.client.findMany({
      where: { ...NOT_DELETED, interestLevel: { not: null } },
      select: { interestLevel: true },
      distinct: ['interestLevel'],
    });
    const all = new Set<string>(DEFAULT_INTEREST_LEVELS);
    for (const r of rows) if (r.interestLevel) all.add(r.interestLevel);
    return [...all];
  }

  /**
   * Перезвоны за период — для отметок «позвонить» в календаре.
   *
   * Область данных обычная: менеджер видит своих клиентов, руководство —
   * всех. Отдаём только то, что нужно отметке: кого, когда и чей клиент.
   */
  async callbacks(user: AuthUser, from?: string, to?: string) {
    const range: Prisma.DateTimeFilter = {};
    if (from) range.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) range.lte = new Date(`${to}T23:59:59.999Z`);

    return this.prisma.client.findMany({
      where: {
        ...NOT_DELETED,
        ...(seesAll(user) ? {} : { managerId: user.id }),
        callbackAt: from || to ? range : { not: null },
      },
      select: {
        id: true,
        fullName: true,
        phone: true,
        callbackAt: true,
        callType: true,
        interestLevel: true,
        manager: { select: { id: true, fullName: true } },
      },
      orderBy: { callbackAt: 'asc' },
      take: 500,
    });
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
