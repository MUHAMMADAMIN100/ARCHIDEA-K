/**
 * Подстановка значений в шаблон КП (ТЗ 9.1/9.2).
 *
 * Чистые функции без обращения к Prisma/БД — легко тестировать и переиспользовать
 * при создании КП и при перерендере после правки (PATCH). Отсутствующее значение
 * всегда даёт пустую строку в тексте клиенту, а не слово "undefined".
 */

/** Значения плейсхолдеров {{ключ}}, поддерживаемых в теле шаблона КП */
export interface ProposalTemplateValues {
  client: string;
  phone: string;
  address: string;
  area: string;
  pricePerSqm: string;
  total: string;
  discount: string;
  manager: string;
  date: string;
  validUntil: string;
  items: string;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** Заменяет {{ключ}} на значение из values. Неизвестный ключ и пустое значение → '' */
export function renderPlaceholders(
  text: string | null | undefined,
  values: Partial<ProposalTemplateValues>,
): string {
  if (!text) return '';
  return text.replace(PLACEHOLDER, (_match, key: string) => {
    const value = (values as Record<string, string | undefined>)[key];
    return value ?? '';
  });
}

/** Собирает полный текст КП: вступление + основной текст + условия */
export function renderProposalBody(
  template: { intro?: string | null; body: string; conditions?: string | null },
  values: Partial<ProposalTemplateValues>,
): string {
  const parts = [
    renderPlaceholders(template.intro, values),
    renderPlaceholders(template.body, values),
    renderPlaceholders(template.conditions, values),
  ]
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.join('\n\n');
}

/** Одна позиция сметы КП (снапшот) */
export interface ProposalItemInput {
  title: string;
  volume?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
}

/** Текстовый список позиций для плейсхолдера {{items}} */
export function formatItemsList(
  items: ProposalItemInput[] | null | undefined,
): string {
  if (!items || items.length === 0) return '';
  return items
    .map((item) => {
      const line = [`• ${item.title}`];
      if (item.volume != null) line.push(`${item.volume}`);
      if (item.unitPrice != null) line.push(`× ${item.unitPrice} сомони`);
      if (item.amount != null) line.push(`= ${item.amount} сомони`);
      return line.join(' ');
    })
    .join('\n');
}

/**
 * Итоговая сумма КП: явный total из overrides имеет приоритет (проверяется
 * вызывающей стороной), иначе — сумма по позициям, иначе площадь×цена,
 * иначе сумма заказа. Скидка вычитается в конце и сумма не уходит в минус.
 */
export function computeProposalTotal(params: {
  items?: ProposalItemInput[] | null;
  area?: number | null;
  pricePerSqm?: number | null;
  fallback?: number | null;
  discount?: number;
}): number {
  const discount = params.discount ?? 0;
  let base: number;
  if (params.items && params.items.length > 0) {
    base = params.items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  } else if (
    /*
     * Именно > 0, а не != null. У заказа поле площади — Int со значением по
     * умолчанию 0, и у мойки мягкой мебели оно так и остаётся нулём: там объём
     * считается в посадочных местах. Проверка на null пропускала этот ноль
     * дальше, и КП по мебели уходило клиенту с суммой 0 сомони.
     */
    (params.area ?? 0) > 0 &&
    (params.pricePerSqm ?? 0) > 0
  ) {
    base = (params.area as number) * (params.pricePerSqm as number);
  } else {
    base = params.fallback ?? 0;
  }
  return Math.max(0, Math.round(base - discount));
}
