import { FinanceCategory, FinanceKind } from '@prisma/client';

/** Человеческое название и тип (доход/расход) для каждой статьи — для селектов на фронте */
export const CATEGORY_META: Record<FinanceCategory, { label: string; kind: FinanceKind }> = {
  ORDER_PAYMENT: { label: 'Оплата заказа', kind: FinanceKind.INCOME },
  OTHER_INCOME: { label: 'Прочий доход', kind: FinanceKind.INCOME },
  SALARY: { label: 'Зарплата', kind: FinanceKind.EXPENSE },
  BONUS: { label: 'Премии', kind: FinanceKind.EXPENSE },
  SUPPLIES: { label: 'Расходные материалы', kind: FinanceKind.EXPENSE },
  TRANSPORT: { label: 'Транспорт', kind: FinanceKind.EXPENSE },
  RENT: { label: 'Аренда', kind: FinanceKind.EXPENSE },
  MARKETING: { label: 'Реклама и продвижение', kind: FinanceKind.EXPENSE },
  TAX: { label: 'Налоги и сборы', kind: FinanceKind.EXPENSE },
  OTHER_EXPENSE: { label: 'Прочий расход', kind: FinanceKind.EXPENSE },
};

export function categoryLabel(category: FinanceCategory): string {
  return CATEGORY_META[category]?.label ?? category;
}

export function kindLabel(kind: FinanceKind): string {
  return kind === FinanceKind.INCOME ? 'Доход' : 'Расход';
}
