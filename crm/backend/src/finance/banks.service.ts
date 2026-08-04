import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { NOT_DELETED, softDeleteData } from '../common/soft-delete';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';

/**
 * Справочник банков для безналичной оплаты (ТЗ 3.1).
 *
 * В ТЗ названы Алиф и Душанбе Сити, но список банков в городе меняется, а
 * правка кода ради нового банка — плохая цена за такую мелочь. Поэтому банки
 * лежат в базе, а руководитель заводит их сам.
 *
 * Три записи помечены системными: их можно переименовать или скрыть, но не
 * удалить — на них уже могут ссылаться проведённые платежи.
 */
@Injectable()
export class BanksService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Действующие банки — то, что видно в выпадающем списке оплаты */
  list() {
    return this.prisma.paymentBank.findMany({
      where: { ...NOT_DELETED, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: { id: true, key: true, title: true, isSystem: true, isActive: true },
    });
  }

  /** Полный список для настроек — вместе со скрытыми */
  listAll() {
    return this.prisma.paymentBank.findMany({
      where: NOT_DELETED,
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        key: true,
        title: true,
        isSystem: true,
        isActive: true,
        sortOrder: true,
      },
    });
  }

  /**
   * Название банка: не пустое и не повторяющее уже заведённое.
   *
   * Проверка общая для создания и правки. Раньше она стояла только на
   * создании, и через правку в справочник проходили и пустое имя (два пробела
   * проходят проверку длины, а после обрезки от них ничего не остаётся), и
   * второй «Алиф» — в книге доходов появлялись два неразличимых канала.
   */
  private async normalizeTitle(raw: string, exceptId?: string): Promise<string> {
    const title = raw.trim();
    if (title.length < 2) throw new BadRequestException('Укажите название банка');

    const twin = await this.prisma.paymentBank.findFirst({
      where: {
        ...NOT_DELETED,
        title: { equals: title, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (twin) throw new BadRequestException('Такой банк уже есть в справочнике');
    return title;
  }

  async create(user: AuthUser, dto: CreateBankDto) {
    const title = await this.normalizeTitle(dto.title);

    const last = await this.prisma.paymentBank.findFirst({
      where: NOT_DELETED,
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const bank = await this.prisma.paymentBank.create({
      data: {
        // ключ нужен только для системных записей — у своих он свободный.
        // Случайный, а не по времени: два банка, заведённых в одну миллисекунду,
        // упирались в уникальный индекс и роняли запрос пятисотой ошибкой
        key: `custom_${randomUUID()}`,
        title,
        sortOrder: dto.sortOrder ?? (last?.sortOrder ?? 0) + 1,
      },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'FINANCE',
      entityId: bank.id,
      entityTitle: `Банк «${bank.title}»`,
      action: AuditAction.CREATE,
      summary: 'Банк добавлен в справочник',
    });
    return bank;
  }

  async update(user: AuthUser, id: string, dto: UpdateBankDto) {
    const before = await this.prisma.paymentBank.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!before) throw new NotFoundException('Банк не найден');

    const title =
      dto.title !== undefined ? await this.normalizeTitle(dto.title, id) : undefined;

    const bank = await this.prisma.paymentBank.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });

    await this.audit.log(this.prisma, {
      user,
      entity: 'FINANCE',
      entityId: bank.id,
      entityTitle: `Банк «${bank.title}»`,
      action: AuditAction.UPDATE,
      summary:
        before.isActive !== bank.isActive
          ? bank.isActive
            ? 'Банк снова доступен для оплаты'
            : 'Банк скрыт из списка оплаты'
          : 'Банк изменён',
    });
    return bank;
  }

  /**
   * Удаление — только для банков, заведённых вручную и ни разу не
   * использованных. Всё остальное скрывается: удалить банк, которым платили,
   * значит потерять канал у проведённых платежей.
   */
  async remove(user: AuthUser, id: string) {
    const bank = await this.prisma.paymentBank.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!bank) throw new NotFoundException('Банк не найден');
    if (bank.isSystem) {
      throw new BadRequestException(
        'Это банк из базового списка — его можно скрыть, но не удалить',
      );
    }

    /*
     * Считаем ВСЕ следы банка, включая удалённые взносы и записи книги
     * доходов. Взнос из корзины можно восстановить, а запись дохода живёт
     * своей жизнью: удали мы банк — в отчёте по каналам осталась бы строка
     * без названия.
     */
    const [inPayments, inFinance] = await Promise.all([
      this.prisma.orderPayment.count({ where: { bankId: id } }),
      this.prisma.financeEntry.count({ where: { bankId: id } }),
    ]);
    const used = inPayments + inFinance;
    if (used > 0) {
      throw new BadRequestException(
        `Банком уже оплачивали (${used} записей) — его можно только скрыть`,
      );
    }

    await this.prisma.paymentBank.update({
      where: { id },
      data: softDeleteData(user, 'Удалён из справочника'),
    });
    await this.audit.log(this.prisma, {
      user,
      entity: 'FINANCE',
      entityId: bank.id,
      entityTitle: `Банк «${bank.title}»`,
      action: AuditAction.DELETE,
      summary: 'Банк удалён из справочника',
    });
    return { ok: true };
  }
}
