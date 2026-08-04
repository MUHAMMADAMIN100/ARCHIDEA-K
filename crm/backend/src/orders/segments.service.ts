import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditAction, FunnelStage, Prisma, SegmentKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, seesAll } from '../common/decorators/current-user.decorator';
import { NOT_DELETED } from '../common/soft-delete';
import { BlockDto, ReplaceSegmentsDto } from './dto/segment.dto';

/** Узел дерева объекта в том виде, в каком он уходит на экран */
export interface SegmentNode {
  id: string;
  kind: SegmentKind;
  title: string;
  area: number | null;
  note: string | null;
  children: SegmentNode[];
}

/**
 * Разбивка объекта на блоки, этажи и помещения (ТЗ: объём работ).
 *
 * Зачем: большой объект нельзя посчитать одной цифрой площади. Бригаде нужно
 * знать, сколько корпусов, этажей и помещений, и сколько метров в каждом —
 * иначе на месте выясняется, что «в 1200 м²» входил ещё и подвал.
 *
 * Дерево сохраняется целиком: менеджер правит структуру как единое целое,
 * промежуточные состояния (добавил этаж → переставил комнату) никому не нужны,
 * а точечные правки узлов породили бы десяток запросов и гонки между ними.
 */
@Injectable()
export class SegmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Заказ доступен этому сотруднику? Менеджер работает только со своими */
  private async loadOrder(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...NOT_DELETED },
      select: { id: true, managerId: true, area: true, stage: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (!seesAll(user) && order.managerId !== user.id) {
      throw new NotFoundException('Заказ не найден');
    }
    return order;
  }

  /**
   * Площадь закрытого заказа через разбивку не переписывается.
   *
   * У оплаченного заказа сумма не может разойтись с оплатой (см.
   * orders.service.update). Подстановка площади из разбивки шла мимо той
   * проверки — и площадь, по которой выставлен счёт, менялась у закрытой
   * сделки без единого вопроса. Саму разбивку править можно: это описание
   * объекта, а не деньги.
   */
  private assertCanApplyArea(order: { stage: FunnelStage }) {
    if (order.stage === FunnelStage.PAID) {
      throw new BadRequestException(
        'Заказ закрыт и оплачен — площадь в нём больше не меняется. ' +
          'Верните заказ в работу, если нужно исправить объём',
      );
    }
  }

  /** Плоский список из базы → дерево для экрана */
  private toTree(
    rows: {
      id: string;
      parentId: string | null;
      kind: SegmentKind;
      title: string;
      area: number | null;
      note: string | null;
      sortOrder: number;
    }[],
  ): SegmentNode[] {
    const byId = new Map<string, SegmentNode>();
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        kind: r.kind,
        title: r.title,
        area: r.area,
        note: r.note,
        children: [],
      });
    }
    const roots: SegmentNode[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (r.parentId && byId.has(r.parentId)) {
        byId.get(r.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /**
   * Итоговая площадь объекта.
   *
   * Считаем по самым мелким частям: если у помещений задана площадь, площадь
   * этажа и блока не складываем — иначе одни и те же метры посчитались бы
   * дважды. Если внутри ничего не задано, берём то, что указано на этом уровне.
   */
  totalArea(nodes: SegmentNode[]): number {
    let sum = 0;
    for (const node of nodes) {
      const inner = this.totalArea(node.children);
      sum += inner > 0 ? inner : (node.area ?? 0);
    }
    return sum;
  }

  async list(user: AuthUser, orderId: string) {
    await this.loadOrder(user, orderId);
    const rows = await this.prisma.orderSegment.findMany({
      where: { orderId },
      orderBy: [{ sortOrder: 'asc' }],
      select: {
        id: true,
        parentId: true,
        kind: true,
        title: true,
        area: true,
        note: true,
        sortOrder: true,
      },
    });
    const blocks = this.toTree(rows);
    return { blocks, totalArea: this.totalArea(blocks) };
  }

  /**
   * Полная замена разбивки.
   *
   * Старые узлы удаляются, новые создаются в одной транзакции: разбивка — это
   * описание объекта, а не документ с историей, и держать её «наполовину
   * обновлённой» нельзя.
   */
  async replace(user: AuthUser, orderId: string, dto: ReplaceSegmentsDto) {
    const order = await this.loadOrder(user, orderId);
    if (dto.applyArea) this.assertCanApplyArea(order);

    /*
     * Потолок на размер дерева.
     *
     * Пределы отдельных списков в DTO допускают миллионы узлов, а живой объект
     * — это десятки помещений. Без общего ограничения один запрос занимал бы
     * соединение с базой на минуты и вываливался по таймауту транзакции,
     * заодно подвешивая остальную работу CRM.
     */
    const MAX_NODES = 2000;
    const rows: {
      id: string;
      parentId: string | null;
      kind: SegmentKind;
      title: string;
      area: number | null;
      note: string | null;
      sortOrder: number;
    }[] = [];

    let sortOrder = 0;
    const addNode = (
      kind: SegmentKind,
      parentId: string | null,
      node: { title: string; area?: number; note?: string },
    ) => {
      const id = randomUUID();
      rows.push({
        id,
        parentId,
        kind,
        title: node.title.trim(),
        area: node.area ?? null,
        note: node.note?.trim() || null,
        sortOrder: sortOrder++,
      });
      return id;
    };

    for (const block of dto.blocks as BlockDto[]) {
      const blockId = addNode(SegmentKind.BLOCK, null, block);
      for (const floor of block.floors ?? []) {
        const floorId = addNode(SegmentKind.FLOOR, blockId, floor);
        for (const room of floor.rooms ?? []) {
          addNode(SegmentKind.ROOM, floorId, room);
        }
      }
    }

    if (rows.length > MAX_NODES) {
      throw new BadRequestException(
        `Слишком подробная разбивка: ${rows.length} частей при пределе ${MAX_NODES}. ` +
          'Объедините мелкие помещения или разнесите объект по нескольким заказам',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.orderSegment.deleteMany({ where: { orderId } });

      /*
       * Записываем уровнями, а не узел за узлом: идентификаторы сгенерированы
       * заранее, поэтому вся разбивка укладывается в три запроса вместо сотен.
       * Порядок важен — этаж ссылается на блок, помещение на этаж.
       */
      for (const kind of [
        SegmentKind.BLOCK,
        SegmentKind.FLOOR,
        SegmentKind.ROOM,
      ]) {
        const chunk = rows.filter((r) => r.kind === kind);
        if (chunk.length) {
          await tx.orderSegment.createMany({
            data: chunk.map((r) => ({ ...r, orderId })),
          });
        }
      }

      const saved = await tx.orderSegment.findMany({
        where: { orderId },
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          parentId: true,
          kind: true,
          title: true,
          area: true,
          note: true,
          sortOrder: true,
        },
      });
      const blocks = this.toTree(saved);
      const totalArea = this.totalArea(blocks);

      /*
       * Площадь заказа обновляем ТОЛЬКО по явной просьбе: это цифра, по
       * которой выставлен счёт, и менять её незаметно при правке структуры
       * нельзя. Сама сумма заказа при этом не пересчитывается — за неё
       * отвечает карточка заказа, где менеджер видит, что меняет.
       */
      let orderArea = order.area;
      if (dto.applyArea) {
        await tx.order.update({
          where: { id: orderId },
          data: { area: totalArea },
        });
        orderArea = totalArea;
        // площадь — часть счёта, её изменение обязано попасть в историю заказа
        await this.audit.log(tx, {
          user,
          entity: 'ORDER',
          entityId: orderId,
          entityTitle: 'Заказ — площадь',
          action: AuditAction.UPDATE,
          summary: `Площадь заказа взята из разбивки: ${order.area} → ${totalArea} м²`,
        });
      }

      const rooms = saved.filter((r) => r.kind === SegmentKind.ROOM).length;
      const floors = saved.filter((r) => r.kind === SegmentKind.FLOOR).length;
      await this.audit.log(tx, {
        user,
        entity: 'ORDER',
        entityId: orderId,
        entityTitle: 'Заказ — разбивка объекта',
        action: AuditAction.UPDATE,
        summary: saved.length
          ? `Объект разбит: ${dto.blocks.length} блок(ов), ${floors} этаж(ей), ${rooms} помещений, ${totalArea} м²`
          : 'Разбивка объекта убрана',
      });

      return { blocks, totalArea, orderArea };
    });

    return result;
  }
}
