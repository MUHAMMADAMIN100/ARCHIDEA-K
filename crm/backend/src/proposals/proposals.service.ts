import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  FunnelStage,
  NotificationType,
  Order,
  Prisma,
  ProposalStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AuthUser,
  seesAll,
} from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { formatDate, parseDate } from '../common/time/dushanbe';
import {
  ChangeProposalStatusDto,
  CreateProposalDto,
  CreateProposalTemplateDto,
  SendProposalDto,
  UpdateProposalDto,
  UpdateProposalTemplateDto,
} from './dto/proposal.dto';
import {
  ProposalItemInput,
  ProposalTemplateValues,
  computeProposalTotal,
  formatItemsList,
  renderProposalBody,
} from './template-render';

/** Прибавка нужных данных к списку/карточке КП без раскрытия лишних полей */
const proposalInclude = {
  client: { select: { id: true, fullName: true, phone: true, managerId: true } },
  order: { select: { id: true, address: true, stage: true } },
  template: { select: { id: true, name: true } },
};

type ProposalTemplateSource = {
  id: string;
  name: string;
  intro: string | null;
  body: string;
  conditions: string | null;
  validDays: number;
};

@Injectable()
export class ProposalsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  private assertCanManageTemplates(user: AuthUser) {
    if (!can(user, 'proposals:templates')) {
      throw new ForbiddenException(
        'Управление шаблонами КП доступно только руководителю',
      );
    }
  }

  private scopeWhere(user: AuthUser): Prisma.ProposalWhereInput {
    return seesAll(user) ? {} : { client: { managerId: user.id } };
  }

  private titleOf(p: { number: number; clientName: string }): string {
    return `КП №${p.number} — ${p.clientName}`;
  }

  private validUntilFrom(days: number): Date {
    // «действительно N дней» — точка во времени, а не граница суток,
    // поэтому обычная арифметика без dushanbe.ts здесь корректна
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /** Цена за единицу: явная правка → цена заказа → медианный тариф по услуге заказа */
  private async resolvePricePerSqm(
    order: { pricePerSqm: number | null; serviceKey: string | null; cleaningType: string } | null,
    override?: number,
  ): Promise<number | null> {
    if (override != null) return override;
    if (!order) return null;
    if (order.pricePerSqm != null) return order.pricePerSqm;
    const key = order.serviceKey ?? order.cleaningType;
    if (!key) return null;
    const tariff = await this.prisma.tariff.findFirst({
      where: { key, ...NOT_DELETED },
    });
    return tariff ? tariff.priceMedium || tariff.pricePerSqm : null;
  }

  private buildValues(params: {
    clientName: string;
    clientPhone?: string | null;
    address?: string | null;
    area?: number | null;
    pricePerSqm?: number | null;
    total: number;
    discount: number;
    managerName: string;
    validUntil?: Date | null;
    items?: ProposalItemInput[] | null;
  }): Partial<ProposalTemplateValues> {
    return {
      client: params.clientName,
      phone: params.clientPhone ?? '',
      address: params.address ?? '',
      area: params.area != null ? String(params.area) : '',
      pricePerSqm: params.pricePerSqm != null ? String(params.pricePerSqm) : '',
      total: String(params.total),
      discount: params.discount ? String(params.discount) : '',
      manager: params.managerName,
      date: formatDate(new Date()),
      validUntil: params.validUntil ? formatDate(params.validUntil) : '',
      items: formatItemsList(params.items ?? null),
    };
  }

  /** Шаблон по id либо основной активный — для генерации нового КП */
  private async resolveTemplate(templateId?: string): Promise<ProposalTemplateSource> {
    if (templateId) {
      const template = await this.prisma.proposalTemplate.findFirst({
        where: { id: templateId, ...NOT_DELETED },
      });
      if (!template) throw new NotFoundException('Шаблон КП не найден');
      return template;
    }
    const byDefault = await this.prisma.proposalTemplate.findFirst({
      where: { isDefault: true, isActive: true, ...NOT_DELETED },
    });
    if (!byDefault) {
      throw new BadRequestException(
        'Нет основного шаблона КП — создайте шаблон и отметьте его основным в разделе «Шаблоны»',
      );
    }
    return byDefault;
  }

  // ─────────────────────── Шаблоны (ТЗ 9.1) ───────────────────────

  listTemplates() {
    return this.prisma.proposalTemplate.findMany({
      where: NOT_DELETED,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createTemplate(user: AuthUser, dto: CreateProposalTemplateDto) {
    this.assertCanManageTemplates(user);
    return this.prisma.$transaction(async (tx) => {
      // основной шаблон — только один
      if (dto.isDefault) {
        await tx.proposalTemplate.updateMany({
          where: { isDefault: true, ...NOT_DELETED },
          data: { isDefault: false },
        });
      }
      const created = await tx.proposalTemplate.create({
        data: {
          name: dto.name.trim(),
          intro: dto.intro?.trim() || null,
          body: dto.body,
          conditions: dto.conditions?.trim() || null,
          validDays: dto.validDays ?? 7,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          createdById: user.id,
        },
      });
      await this.audit.log(tx, {
        user,
        entity: 'PROPOSAL',
        entityId: created.id,
        entityTitle: `Шаблон КП «${created.name}»`,
        action: AuditAction.CREATE,
        summary: `Создан шаблон КП «${created.name}»`,
      });
      return created;
    });
  }

  async updateTemplate(
    user: AuthUser,
    id: string,
    dto: UpdateProposalTemplateDto,
  ) {
    this.assertCanManageTemplates(user);
    const before = await this.prisma.proposalTemplate.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!before) throw new NotFoundException('Шаблон КП не найден');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.proposalTemplate.updateMany({
          where: { isDefault: true, id: { not: id }, ...NOT_DELETED },
          data: { isDefault: false },
        });
      }

      const data: Prisma.ProposalTemplateUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.intro !== undefined) data.intro = dto.intro.trim() || null;
      if (dto.body !== undefined) data.body = dto.body;
      if (dto.conditions !== undefined) {
        data.conditions = dto.conditions.trim() || null;
      }
      if (dto.validDays !== undefined) data.validDays = dto.validDays;
      if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;

      const after = await tx.proposalTemplate.update({ where: { id }, data });

      await this.audit.log(tx, {
        user,
        entity: 'PROPOSAL',
        entityId: after.id,
        entityTitle: `Шаблон КП «${after.name}»`,
        action: AuditAction.UPDATE,
        changes: this.audit.diff(before, after, [
          'name',
          'intro',
          'body',
          'conditions',
          'validDays',
          'isDefault',
          'isActive',
        ]),
      });
      return after;
    });
  }

  async removeTemplate(user: AuthUser, id: string, reason?: string) {
    this.assertCanManageTemplates(user);
    const template = await this.prisma.proposalTemplate.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!template) throw new NotFoundException('Шаблон КП не найден');

    await this.prisma.proposalTemplate.update({
      where: { id },
      data: { ...softDeleteData(user, reason), isDefault: false },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'PROPOSAL',
      entityId: template.id,
      entityTitle: `Шаблон КП «${template.name}»`,
      action: AuditAction.DELETE,
      summary: 'Шаблон КП перенесён в корзину',
    });
    return { ok: true };
  }

  // ─────────────────────── КП (ТЗ 9.1/9.2) ───────────────────────

  list(
    user: AuthUser,
    q: {
      from?: string;
      to?: string;
      clientId?: string;
      orderId?: string;
      status?: ProposalStatus;
      managerId?: string;
    },
  ) {
    const where: Prisma.ProposalWhereInput = {
      ...NOT_DELETED,
      ...this.scopeWhere(user),
    };
    if (q.clientId) where.clientId = q.clientId;
    if (q.orderId) where.orderId = q.orderId;
    if (q.status) where.status = q.status;
    if (seesAll(user) && q.managerId) where.client = { managerId: q.managerId };

    if (q.from || q.to) {
      const range: Prisma.DateTimeFilter = {};
      if (q.from) range.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) range.lte = new Date(`${q.to}T23:59:59.999Z`);
      where.createdAt = range;
    }

    return this.prisma.proposal.findMany({
      where,
      include: proposalInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOne(user: AuthUser, id: string) {
    const proposal = await this.prisma.proposal.findFirst({
      where: { id, ...NOT_DELETED },
      include: proposalInclude,
    });
    if (!proposal) throw new NotFoundException('КП не найдено');
    if (!seesAll(user) && proposal.client.managerId !== user.id) {
      throw new NotFoundException('КП не найдено');
    }
    return proposal;
  }

  async create(user: AuthUser, dto: CreateProposalDto) {
    const client = await this.prisma.client.findFirst({
      where: { id: dto.clientId, ...NOT_DELETED },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    if (!seesAll(user) && client.managerId !== user.id) {
      throw new NotFoundException('Клиент не найден');
    }

    let order: Order | null = null;
    if (dto.orderId) {
      order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, ...NOT_DELETED },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.clientId !== client.id) {
        throw new BadRequestException('Заказ принадлежит другому клиенту');
      }
    }

    const template = await this.resolveTemplate(dto.templateId);

    const overrides = dto.overrides;
    const discount = overrides?.discount ?? 0;
    const area = overrides?.area ?? order?.area ?? null;
    const pricePerSqm = await this.resolvePricePerSqm(order, overrides?.pricePerSqm);
    const items: ProposalItemInput[] | null = overrides?.items ?? null;
    const address = overrides?.address ?? order?.address ?? null;
    const total =
      overrides?.total ??
      computeProposalTotal({
        items,
        area,
        pricePerSqm,
        fallback: order?.finalPrice ?? order?.estimatedPrice ?? null,
        discount,
      });
    const validUntil = this.validUntilFrom(template.validDays);

    const values = this.buildValues({
      clientName: client.fullName,
      clientPhone: client.phone,
      address,
      area,
      pricePerSqm,
      total,
      discount,
      managerName: user.fullName,
      validUntil,
      items,
    });
    const bodySnapshot = renderProposalBody(template, values);

    const created = await this.prisma.proposal.create({
      data: {
        clientId: client.id,
        orderId: order?.id,
        templateId: template.id,
        templateName: template.name,
        clientName: client.fullName,
        clientPhone: client.phone,
        address,
        area,
        pricePerSqm,
        total,
        discount,
        items: items && items.length
          ? (items as unknown as Prisma.InputJsonValue)
          : undefined,
        bodySnapshot,
        validUntil,
        createdById: user.id,
        createdByName: user.fullName,
      },
      include: proposalInclude,
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'PROPOSAL',
      entityId: created.id,
      entityTitle: this.titleOf(created),
      action: AuditAction.CREATE,
      summary: `Создано КП №${created.number} на ${created.total} сомони`,
    });

    return created;
  }

  async update(user: AuthUser, id: string, dto: UpdateProposalDto) {
    const proposal = await this.getOne(user, id);

    if (proposal.status !== ProposalStatus.DRAFT && user.role !== Role.DIRECTOR) {
      throw new BadRequestException(
        'КП уже отправлено клиенту — редактировать может только директор',
      );
    }

    // если меняется шаблон — подтягиваем полный текст нового
    let newTemplate: ProposalTemplateSource | null = null;
    if (dto.templateId && dto.templateId !== proposal.templateId) {
      newTemplate = await this.prisma.proposalTemplate.findFirst({
        where: { id: dto.templateId, ...NOT_DELETED },
      });
      if (!newTemplate) throw new NotFoundException('Шаблон КП не найден');
    }

    const address = dto.address ?? proposal.address;
    const area = dto.area ?? proposal.area;
    const pricePerSqm = dto.pricePerSqm ?? proposal.pricePerSqm;
    const discount = dto.discount ?? proposal.discount;
    const items: ProposalItemInput[] | null =
      dto.items ?? (proposal.items as unknown as ProposalItemInput[] | null);
    const validUntil = dto.validUntil ? parseDate(dto.validUntil) : proposal.validUntil;

    const affectsTotal =
      dto.total !== undefined ||
      dto.items !== undefined ||
      dto.discount !== undefined ||
      dto.area !== undefined ||
      dto.pricePerSqm !== undefined;
    const total = dto.total ?? (
      affectsTotal
        ? computeProposalTotal({ items, area, pricePerSqm, fallback: proposal.total, discount })
        : proposal.total
    );

    let bodySnapshot = proposal.bodySnapshot;
    if (dto.bodySnapshot !== undefined) {
      // ручная правка текста — автоперерендер не трогаем
      bodySnapshot = dto.bodySnapshot;
    } else {
      const needsRerender =
        newTemplate !== null ||
        dto.address !== undefined ||
        dto.area !== undefined ||
        dto.pricePerSqm !== undefined ||
        dto.discount !== undefined ||
        dto.total !== undefined ||
        dto.items !== undefined ||
        dto.validUntil !== undefined;

      if (needsRerender) {
        const source =
          newTemplate ??
          (proposal.templateId
            ? await this.prisma.proposalTemplate.findFirst({
                where: { id: proposal.templateId, ...NOT_DELETED },
              })
            : null);
        // если шаблон уже в корзине — текст оставляем как есть, а не роняем правку
        if (source) {
          const values = this.buildValues({
            clientName: proposal.clientName,
            clientPhone: proposal.clientPhone,
            address,
            area,
            pricePerSqm,
            total,
            discount,
            managerName: proposal.createdByName,
            validUntil,
            items,
          });
          bodySnapshot = renderProposalBody(source, values);
        }
      }
    }

    const updated = await this.prisma.proposal.update({
      where: { id },
      data: {
        templateId: newTemplate?.id ?? proposal.templateId,
        templateName: newTemplate?.name ?? proposal.templateName,
        address,
        area,
        pricePerSqm,
        discount,
        total,
        items: items && items.length
          ? (items as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        bodySnapshot,
        validUntil,
      },
      include: proposalInclude,
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'PROPOSAL',
      entityId: updated.id,
      entityTitle: this.titleOf(updated),
      action: AuditAction.UPDATE,
      changes: this.audit.diff(proposal, updated, [
        'address',
        'area',
        'pricePerSqm',
        'discount',
        'total',
        'validUntil',
      ]),
    });

    return updated;
  }

  /** ТЗ 9.2 — отметка об отправке: кто и когда отправил */
  async send(user: AuthUser, id: string, dto: SendProposalDto) {
    const proposal = await this.getOne(user, id);
    if (proposal.status !== ProposalStatus.DRAFT) {
      throw new BadRequestException('КП уже отправлено клиенту');
    }

    const sentAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const sent = await tx.proposal.update({
        where: { id },
        data: {
          status: ProposalStatus.SENT,
          sentById: user.id,
          sentByName: user.fullName,
          sentAt,
        },
        include: proposalInclude,
      });

      /*
       * Этап «Коммерческое предложение» исключён из воронки (ТЗ 3), поэтому
       * отправка КП больше НЕ двигает заказ. Статус отправки виден в самом
       * разделе КП; этап заказа менеджер меняет осознанно, в воронке.
       */

      await this.audit.log(tx, {
        user,
        entity: 'PROPOSAL',
        entityId: sent.id,
        entityTitle: this.titleOf(sent),
        action: AuditAction.STAGE_CHANGE,
        summary: `Черновик → Отправлено (${sent.total} сомони)${dto.note ? `. ${dto.note.trim()}` : ''}`,
      });

      return sent;
    });

    await this.notifications.notifyDirectors({
      type: NotificationType.PROPOSAL_SENT,
      title: 'КП отправлено клиенту',
      message: `${user.fullName} отправил(а) КП №${updated.number} клиенту «${updated.clientName}» на ${updated.total} сомони`,
      orderId: updated.orderId ?? undefined,
    });

    return updated;
  }

  /** Смена статуса после отправки: принято или отклонено */
  async changeStatus(user: AuthUser, id: string, dto: ChangeProposalStatusDto) {
    const proposal = await this.getOne(user, id);
    if (proposal.status !== ProposalStatus.SENT) {
      throw new BadRequestException(
        'Менять статус на «принято»/«отклонено» можно только у отправленного КП',
      );
    }

    const updated = await this.prisma.proposal.update({
      where: { id },
      data: { status: dto.status },
      include: proposalInclude,
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'PROPOSAL',
      entityId: updated.id,
      entityTitle: this.titleOf(updated),
      action: AuditAction.STAGE_CHANGE,
      summary: `Отправлено → ${dto.status === ProposalStatus.ACCEPTED ? 'Принято' : 'Отклонено'}`,
    });

    return updated;
  }

  async remove(user: AuthUser, id: string, reason?: string) {
    const proposal = await this.getOne(user, id);

    await this.prisma.proposal.update({
      where: { id },
      data: softDeleteData(user, reason),
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'PROPOSAL',
      entityId: proposal.id,
      entityTitle: this.titleOf(proposal),
      action: AuditAction.DELETE,
      summary: 'КП перенесено в корзину',
    });

    return { ok: true };
  }
}
