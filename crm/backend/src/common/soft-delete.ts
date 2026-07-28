import { AuthUser } from './decorators/current-user.decorator';

/**
 * Корзина (ТЗ 6): удаление переносит запись в архив, а не стирает её.
 *
 * Каждая выборка обязана исключать удалённое явным `...NOT_DELETED` в `where`.
 * Автоматическая фильтрация через Prisma Client Extension сознательно не
 * используется: она подменяет тип PrismaService во всех пятнадцати сервисах,
 * не покрывает findUnique и вложенные include — цена ошибки выше выгоды.
 */
export const NOT_DELETED = { deletedAt: null } as const;

/** Данные для пометки записи как удалённой */
export function softDeleteData(user: AuthUser, reason?: string | null) {
  return {
    deletedAt: new Date(),
    deletedById: user.id,
    deleteReason: reason?.trim() || null,
  };
}

/** Данные для возврата записи из корзины */
export const restoreData = {
  deletedAt: null,
  deletedById: null,
  deleteReason: null,
} as const;
