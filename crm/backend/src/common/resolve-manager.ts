import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './decorators/current-user.decorator';
import { NOT_DELETED } from './soft-delete';

/** Клиент Prisma или транзакция — назначение бывает частью большей операции */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * Кто станет ответственным за клиента или заказ.
 *
 * Правило одно на оба случая: выбранный в форме сотрудник, а если выбора не
 * было — тот, кто создаёт запись.
 *
 * Раньше в обоих сервисах стояло `seesAll(user) ? dto.managerId : user.id`:
 * менеджер не мог передать клиента коллеге вообще — сервер молча ставил
 * создателя, даже когда в форме выбрали другого человека. Поле в интерфейсе
 * при этом показывалось только руководителю, так что расхождение никто не
 * замечал, пока не спросили.
 *
 * Живёт отдельным помощником, а не методом ClientsService: заказам он нужен
 * тоже, а внедрять один сервис в другой ради двадцати строк — заводить
 * круговую зависимость между модулями.
 */
export async function resolveManager(
  db: Db,
  user: AuthUser,
  wanted?: string | null,
): Promise<string | null> {
  if (!wanted || wanted === user.id) return user.id;

  /*
   * Проверяем, что человек существует, работает и не в корзине. Битый или
   * уволенный идентификатор молча не пропускаем: клиент повис бы на том, кто
   * его не ведёт, и заявки по нему потерялись бы.
   */
  const target = await db.user.findFirst({
    where: { id: wanted, isActive: true, ...NOT_DELETED },
    select: { id: true },
  });
  if (!target) {
    throw new BadRequestException(
      'Выбранный сотрудник не найден или отключён — обновите страницу',
    );
  }
  return target.id;
}
