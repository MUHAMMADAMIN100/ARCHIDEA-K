import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ChecklistStatus,
  CleaningType,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import {
  AddChecklistItemDto,
  ApplyChecklistTemplateDto,
  CreateChecklistTemplateDto,
  ToggleChecklistItemDto,
  UpdateChecklistTemplateDto,
} from './dto/checklist.dto';

/** Порядок сортировки пунктов чек-листа: по разделу, затем по sortOrder */
const ITEMS_ORDER: Prisma.OrderChecklistItemOrderByWithRelationInput[] = [
  { section: 'asc' },
  { sortOrder: 'asc' },
];
const TEMPLATE_ITEMS_ORDER: Prisma.ChecklistTemplateItemOrderByWithRelationInput[] =
  [{ section: 'asc' }, { sortOrder: 'asc' }];

function requirePermission(user: AuthUser) {
  if (!can(user, 'checklists:manage')) {
    throw new ForbiddenException(
      'Управление шаблонами чек-листов доступно только руководству',
    );
  }
}

@Injectable()
export class ChecklistsService {
  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
    private notifications: NotificationsService,
    private audit: AuditService,
  ) {}

  // ───────────────────────── Шаблоны ─────────────────────────

  /**
   * Список шаблонов. Без фильтров — все (для экрана управления шаблонами,
   * где нужно видеть и отключённые). С фильтром — только активные и подходящие
   * по виду уборки/услуге (совпадение ИЛИ «общий» шаблон с null).
   */
  listTemplates(q: { cleaningType?: CleaningType; serviceKey?: string }) {
    const where: Prisma.ChecklistTemplateWhereInput = { ...NOT_DELETED };
    const and: Prisma.ChecklistTemplateWhereInput[] = [];
    if (q.cleaningType) {
      and.push({ OR: [{ cleaningType: null }, { cleaningType: q.cleaningType }] });
    }
    if (q.serviceKey) {
      and.push({ OR: [{ serviceKey: null }, { serviceKey: q.serviceKey }] });
    }
    if (and.length) {
      where.isActive = true;
      where.AND = and;
    }
    return this.prisma.checklistTemplate.findMany({
      where,
      include: { items: { orderBy: TEMPLATE_ITEMS_ORDER } },
      orderBy: { name: 'asc' },
    });
  }

  private async getTemplateOrThrow(id: string) {
    const template = await this.prisma.checklistTemplate.findFirst({
      where: { id, ...NOT_DELETED },
      include: { items: { orderBy: TEMPLATE_ITEMS_ORDER } },
    });
    if (!template) throw new NotFoundException('Шаблон чек-листа не найден');
    return template;
  }

  async createTemplate(user: AuthUser, dto: CreateChecklistTemplateDto) {
    requirePermission(user);
    const template = await this.prisma.checklistTemplate.create({
      data: {
        name: dto.name.trim(),
        cleaningType: dto.cleaningType ?? null,
        serviceKey: dto.serviceKey?.trim() || null,
        isActive: dto.isActive ?? true,
        createdById: user.id,
        items: {
          create: dto.items.map((item, index) => ({
            title: item.title.trim(),
            section: item.section?.trim() || null,
            required: item.required ?? false,
            sortOrder: item.sortOrder ?? index,
          })),
        },
      },
      include: { items: { orderBy: TEMPLATE_ITEMS_ORDER } },
    });
    await this.audit.log(this.prisma, {
      user,
      entity: 'CHECKLIST',
      entityId: template.id,
      entityTitle: `Шаблон чек-листа — ${template.name}`,
      action: AuditAction.CREATE,
      summary: `Создан шаблон «${template.name}» (${template.items.length} пунктов)`,
    });
    return template;
  }

  async updateTemplate(
    user: AuthUser,
    id: string,
    dto: UpdateChecklistTemplateDto,
  ) {
    requirePermission(user);
    const existing = await this.getTemplateOrThrow(id);

    const data: Prisma.ChecklistTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.cleaningType !== undefined) data.cleaningType = dto.cleaningType;
    if (dto.serviceKey !== undefined) {
      data.serviceKey = dto.serviceKey?.trim() || null;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.$transaction(async (tx) => {
      const template = await tx.checklistTemplate.update({
        where: { id },
        data,
      });
      // items — полная замена: правка задним числом не должна трогать уже
      // выданные OrderChecklist (там снапшот), поэтому просто чистим и создаём заново
      if (dto.items) {
        await tx.checklistTemplateItem.deleteMany({ where: { templateId: id } });
        await tx.checklistTemplateItem.createMany({
          data: dto.items.map((item, index) => ({
            templateId: id,
            title: item.title.trim(),
            section: item.section?.trim() || null,
            required: item.required ?? false,
            sortOrder: item.sortOrder ?? index,
          })),
        });
      }
      const changes = this.audit.diff(existing, template, [
        'name',
        'cleaningType',
        'serviceKey',
        'isActive',
      ]);
      await this.audit.log(tx, {
        user,
        entity: 'CHECKLIST',
        entityId: template.id,
        entityTitle: `Шаблон чек-листа — ${template.name}`,
        action: AuditAction.UPDATE,
        summary: dto.items ? 'Изменён шаблон и состав пунктов' : 'Изменён шаблон',
        changes,
      });
      return tx.checklistTemplate.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: TEMPLATE_ITEMS_ORDER } },
      });
    });
    return updated;
  }

  async removeTemplate(user: AuthUser, id: string) {
    requirePermission(user);
    const existing = await this.getTemplateOrThrow(id);
    await this.prisma.checklistTemplate.update({
      where: { id },
      data: softDeleteData(user),
    });
    await this.audit.log(this.prisma, {
      user,
      entity: 'CHECKLIST',
      entityId: existing.id,
      entityTitle: `Шаблон чек-листа — ${existing.name}`,
      action: AuditAction.DELETE,
      summary: 'Шаблон перемещён в корзину',
    });
    return { ok: true };
  }

  // ─────────────────── Чек-лист конкретного заказа ───────────────────

  /** Заказ + проверка доступа: менеджер — только свой, директор/ops — любой */
  private async getAccessibleOrder(user: AuthUser, orderId: string) {
    return this.orders.getOne(user, orderId);
  }

  private async getChecklistOrThrow(orderId: string) {
    const checklist = await this.prisma.orderChecklist.findUnique({
      where: { orderId },
      include: { items: { orderBy: ITEMS_ORDER } },
    });
    if (!checklist) throw new NotFoundException('Чек-лист по заказу не найден');
    return checklist;
  }

  async getOrderChecklist(user: AuthUser, orderId: string) {
    await this.getAccessibleOrder(user, orderId);
    return this.prisma.orderChecklist.findUnique({
      where: { orderId },
      include: { items: { orderBy: ITEMS_ORDER } },
    });
  }

  async applyTemplate(
    user: AuthUser,
    orderId: string,
    dto: ApplyChecklistTemplateDto,
  ) {
    const order = await this.getAccessibleOrder(user, orderId);

    const already = await this.prisma.orderChecklist.findUnique({
      where: { orderId },
    });
    if (already) {
      throw new BadRequestException('У заказа уже есть чек-лист');
    }

    let templateName = 'Без шаблона';
    let usesLevels = false;
    let items: {
      title: string;
      hint: string | null;
      section: string | null;
      required: boolean;
      sortOrder: number;
    }[] = [];

    if (dto.templateId) {
      const template = await this.getTemplateOrThrow(dto.templateId);
      templateName = template.name;
      // признак шкалы копируем в чек-лист заказа: шаблон могут потом изменить,
      // а уже начатый чек-лист должен остаться таким, каким его заполняли
      usesLevels = template.usesLevels;
      items = template.items.map((i) => ({
        title: i.title,
        hint: i.hint,
        section: i.section,
        required: i.required,
        sortOrder: i.sortOrder,
      }));
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const checklist = await tx.orderChecklist.create({
          data: {
            orderId,
            templateId: dto.templateId ?? null,
            templateName,
            usesLevels,
            createdById: user.id,
            items: { create: items },
          },
          include: { items: { orderBy: ITEMS_ORDER } },
        });
        await this.audit.log(tx, {
          user,
          entity: 'CHECKLIST',
          entityId: checklist.id,
          entityTitle: `Чек-лист заказа — ${order.client.fullName}`,
          action: AuditAction.CREATE,
          summary: `Применён шаблон «${templateName}» (${items.length} пунктов)`,
        });
        return checklist;
      });
    } catch (e) {
      // гонка двух одновременных запросов на создание чек-листа одного заказа
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('У заказа уже есть чек-лист');
      }
      throw e;
    }
  }

  async toggleItem(
    user: AuthUser,
    orderId: string,
    itemId: string,
    dto: ToggleChecklistItemDto,
  ) {
    const order = await this.getAccessibleOrder(user, orderId);
    const checklist = await this.getChecklistOrThrow(orderId);
    const item = checklist.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Пункт чек-листа не найден');

    const { updatedItem, becameDone, updatedChecklist } =
      await this.prisma.$transaction(async (tx) => {
        /*
         * Пункт можно менять двумя способами: отметить выполненным (контроль
         * качества) или поставить оценку загрязнения (приём объекта). Оценка
         * сама означает, что пункт осмотрен, — иначе чек-лист приёма никогда
         * не считался бы заполненным.
         */
        const levelGiven = dto.level !== undefined;
        const nextLevel = levelGiven ? dto.level : item.level;
        const nextDone =
          dto.isDone !== undefined
            ? dto.isDone
            : levelGiven
              ? dto.level !== null
              : item.isDone;

        const updatedItem = await tx.orderChecklistItem.update({
          where: { id: itemId },
          data: {
            isDone: nextDone,
            level: nextLevel,
            comment:
              dto.comment !== undefined ? dto.comment?.trim() || null : item.comment,
            doneById: nextDone ? user.id : null,
            doneByName: nextDone ? user.fullName : null,
            doneAt: nextDone ? new Date() : null,
          },
        });
        const { checklist: updatedChecklist, becameDone } =
          await this.recalcStatus(tx, checklist);
        return { updatedItem, becameDone, updatedChecklist };
      });

    if (becameDone) {
      await this.notifyChecklistDone(
        user,
        order,
        updatedChecklist,
        'Все обязательные пункты выполнены — чек-лист закрыт автоматически',
      );
    }
    return updatedItem;
  }

  async addItem(user: AuthUser, orderId: string, dto: AddChecklistItemDto) {
    const order = await this.getAccessibleOrder(user, orderId);
    const checklist = await this.getChecklistOrThrow(orderId);

    const { item, becameDone, updatedChecklist } = await this.prisma.$transaction(
      async (tx) => {
        const item = await tx.orderChecklistItem.create({
          data: {
            checklistId: checklist.id,
            title: dto.title.trim(),
            section: dto.section?.trim() || null,
            required: dto.required ?? false,
            sortOrder: dto.sortOrder ?? checklist.items.length,
          },
        });
        // добавление нового обязательного пункта могло сделать чек-лист «неполным» —
        // пересчитываем на случай ранее закрытого DONE (перевода назад не делаем,
        // только пересчёт IN_PROGRESS/OPEN не трогает уже завершённый чек-лист)
        const { checklist: updatedChecklist, becameDone } =
          await this.recalcStatus(tx, checklist);
        return { item, becameDone, updatedChecklist };
      },
    );

    if (becameDone) {
      await this.notifyChecklistDone(
        user,
        order,
        updatedChecklist,
        'Все обязательные пункты выполнены — чек-лист закрыт автоматически',
      );
    }
    return item;
  }

  async removeItem(user: AuthUser, orderId: string, itemId: string) {
    const order = await this.getAccessibleOrder(user, orderId);
    const checklist = await this.getChecklistOrThrow(orderId);
    const item = checklist.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Пункт чек-листа не найден');

    const { becameDone, updatedChecklist } = await this.prisma.$transaction(
      async (tx) => {
        await tx.orderChecklistItem.delete({ where: { id: itemId } });
        const { checklist: updatedChecklist, becameDone } =
          await this.recalcStatus(tx, checklist);
        return { becameDone, updatedChecklist };
      },
    );

    if (becameDone) {
      await this.notifyChecklistDone(
        user,
        order,
        updatedChecklist,
        'Удалён невыполненный обязательный пункт — оставшиеся условия выполнены, чек-лист закрыт',
      );
    }
    return { ok: true };
  }

  async complete(user: AuthUser, orderId: string) {
    const order = await this.getAccessibleOrder(user, orderId);
    const checklist = await this.getChecklistOrThrow(orderId);

    const requiredNotDone = checklist.items.filter(
      (i) => i.required && !i.isDone,
    );
    if (requiredNotDone.length > 0) {
      throw new BadRequestException(
        'Не все обязательные пункты чек-листа отмечены выполненными',
      );
    }

    if (checklist.status === ChecklistStatus.DONE) {
      return checklist; // уже закрыт — повторное уведомление не нужно
    }

    /*
     * Закрываем условным обновлением, а не проверкой с последующей записью:
     * два одновременных запроса (двойной клик, повтор после таймаута) оба
     * прошли бы проверку выше и оба отправили бы уведомление и запись в журнал.
     * Здесь до записи доходит ровно один — второй увидит count = 0.
     */
    const claimed = await this.prisma.orderChecklist.updateMany({
      where: { id: checklist.id, status: { not: ChecklistStatus.DONE } },
      data: { status: ChecklistStatus.DONE, completedAt: new Date() },
    });

    const updated = await this.prisma.orderChecklist.findUniqueOrThrow({
      where: { id: checklist.id },
      include: { items: { orderBy: ITEMS_ORDER } },
    });

    if (claimed.count === 0) {
      return updated; // закрыл кто-то другой в этот же момент
    }

    await this.notifyChecklistDone(
      user,
      order,
      updated,
      'Чек-лист закрыт вручную — все обязательные пункты выполнены',
    );
    return updated;
  }

  async removeChecklist(user: AuthUser, orderId: string) {
    if (!can(user, 'checklists:manage')) {
      throw new ForbiddenException(
        'Удалить чек-лист заказа может только руководство',
      );
    }
    const order = await this.getAccessibleOrder(user, orderId);
    const checklist = await this.prisma.orderChecklist.findUnique({
      where: { orderId },
    });
    if (!checklist) throw new NotFoundException('Чек-лист по заказу не найден');

    // это экземпляр на заказе (снапшот), а не документ — физическое удаление,
    // корзина в ТЗ 6 для него не предусмотрена
    await this.prisma.orderChecklist.delete({ where: { id: checklist.id } });
    await this.audit.log(this.prisma, {
      user,
      entity: 'CHECKLIST',
      entityId: checklist.id,
      entityTitle: `Чек-лист заказа — ${order.client.fullName}`,
      action: AuditAction.DELETE,
      summary: 'Чек-лист удалён',
    });
    return { ok: true };
  }

  /**
   * Пересчёт статуса по фактическому состоянию пунктов:
   * OPEN — ничего не отмечено; IN_PROGRESS — отмечен хоть один пункт, но есть
   * незакрытые обязательные; DONE — отмечен хоть один пункт и все обязательные закрыты.
   * Уже закрытый DONE автоматическим пересчётом назад не откатывается —
   * обратный переход возможен только явным действием (снятие галочки не «ломает» отчёт).
   */
  private async recalcStatus(
    tx: Prisma.TransactionClient,
    checklist: { id: string; status: ChecklistStatus; completedAt: Date | null },
  ) {
    const items = await tx.orderChecklistItem.findMany({
      where: { checklistId: checklist.id },
    });
    const requiredNotDone = items.filter((i) => i.required && !i.isDone).length;
    const anyDone = items.some((i) => i.isDone);

    let status: ChecklistStatus;
    if (checklist.status === ChecklistStatus.DONE) {
      status = ChecklistStatus.DONE;
    } else if (!anyDone) {
      status = ChecklistStatus.OPEN;
    } else {
      status = requiredNotDone > 0 ? ChecklistStatus.IN_PROGRESS : ChecklistStatus.DONE;
    }

    const becameDone =
      status === ChecklistStatus.DONE && checklist.status !== ChecklistStatus.DONE;

    const updated = await tx.orderChecklist.update({
      where: { id: checklist.id },
      data: {
        status,
        completedAt:
          status === ChecklistStatus.DONE ? checklist.completedAt ?? new Date() : null,
      },
      include: { items: { orderBy: ITEMS_ORDER } },
    });
    return { checklist: updated, becameDone };
  }

  private async notifyChecklistDone(
    user: AuthUser,
    order: { id: string; managerId: string | null; client: { fullName: string } },
    checklist: { id: string },
    summary: string,
  ) {
    if (order.managerId) {
      await this.notifications.notify({
        userId: order.managerId,
        type: NotificationType.CHECKLIST_DONE,
        title: 'Чек-лист выполнен',
        message: `Чек-лист по заказу «${order.client.fullName}» полностью закрыт`,
        orderId: order.id,
      });
    }
    await this.audit.log(this.prisma, {
      user,
      entity: 'CHECKLIST',
      entityId: checklist.id,
      entityTitle: `Чек-лист заказа — ${order.client.fullName}`,
      action: AuditAction.UPDATE,
      summary,
    });
  }
}
