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
  /**
   * Раздел сметы: «Работы», «Дополнительные услуги» и т.п. (ТЗ 9).
   * Пусто — позиция идёт без заголовка, как было раньше.
   */
  section?: string | null;
  /** Единица объёма: м², место, шт — чтобы «120» не читалось как штуки */
  unit?: string | null;
}

/**
 * Текстовый список позиций для плейсхолдера {{items}}.
 *
 * Позиции с разделом группируются под его заголовком — клиент видит смету
 * блоками («Работы», «Дополнительные услуги»), а не сплошным перечнем.
 * Порядок разделов — тот, в котором они встретились.
 */
export function formatItemsList(
  items: ProposalItemInput[] | null | undefined,
): string {
  if (!items || items.length === 0) return '';

  const line = (item: ProposalItemInput): string => {
    const parts = [`• ${item.title}`];
    if (item.volume != null) {
      // единица нужна, чтобы «100» не читалось как сто штук
      parts.push(item.unit ? `${item.volume} ${item.unit}` : `${item.volume}`);
    }
    if (item.unitPrice != null) parts.push(`× ${item.unitPrice} сомони`);
    if (item.amount != null) parts.push(`= ${item.amount} сомони`);
    return parts.join(' ');
  };

  const order: string[] = [];
  const bySection = new Map<string, string[]>();
  for (const item of items) {
    const key = item.section?.trim() || '';
    if (!bySection.has(key)) {
      bySection.set(key, []);
      order.push(key);
    }
    bySection.get(key)!.push(line(item));
  }

  // разделов нет вовсе — печатаем плоским списком, как было раньше
  if (order.length === 1 && order[0] === '') {
    return bySection.get('')!.join('\n');
  }

  return order
    .map((name) => {
      const rows = bySection.get(name)!.join('\n');
      return name ? `${name}:\n${rows}` : rows;
    })
    .join('\n\n');
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
