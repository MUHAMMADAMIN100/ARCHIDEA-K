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
  /** Что входит в услугу — построчно (ТЗ: объём работ) */
  included: string;
  /** Что не входит и оплачивается отдельно */
  excluded: string;
}

/**
 * Как подстановка называется по-русски.
 *
 * Раньше в шаблоне стояло `{{client}}`, и человеку, который не работал с
 * шаблонами, это ничего не говорило: непонятно, что за скобки, почему
 * по-английски и можно ли их стирать. Теперь в тексте пишется
 * `{{Имя клиента}}` — и объяснять нечего.
 *
 * Английские названия продолжают работать (см. resolveKey): шаблоны, где
 * они остались, ломать нельзя.
 */
export const PLACEHOLDER_LABELS: Record<keyof ProposalTemplateValues, string> = {
  client: 'Имя клиента',
  phone: 'Телефон',
  address: 'Адрес объекта',
  area: 'Площадь',
  pricePerSqm: 'Цена за единицу',
  total: 'Итоговая сумма',
  discount: 'Скидка',
  manager: 'Менеджер',
  date: 'Дата составления',
  validUntil: 'Срок действия',
  items: 'Список работ и цен',
  included: 'Что входит',
  excluded: 'Что не входит',
};

/** «  имя   КЛИЕНТА » → «имя клиента»: регистр и лишние пробелы не важны */
function normalize(token: string): string {
  return token.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Как ещё человек может назвать ту же подстановку.
 *
 * Люди пишут по-своему: «Клиент» вместо «Имя клиента», «Итого» вместо
 * «Итоговая сумма». Раз мы позвали их писать по-русски, надо понимать и
 * привычные слова — иначе строка молча уйдёт клиенту пустой.
 */
const ALIASES: Record<string, keyof ProposalTemplateValues> = {
  клиент: 'client',
  'фио клиента': 'client',
  'имя': 'client',
  'номер телефона': 'phone',
  'телефон клиента': 'phone',
  адрес: 'address',
  'адрес клиента': 'address',
  объект: 'address',
  объём: 'area',
  'объём работ': 'area',
  'площадь объекта': 'area',
  'цена за м2': 'pricePerSqm',
  'цена за м²': 'pricePerSqm',
  'цена за единицу измерения': 'pricePerSqm',
  сумма: 'total',
  итого: 'total',
  'итого к оплате': 'total',
  'общая сумма': 'total',
  'ответственный менеджер': 'manager',
  дата: 'date',
  'действительно до': 'validUntil',
  'срок действия кп': 'validUntil',
  смета: 'items',
  'список позиций': 'items',
  'состав работ': 'items',
};

/** Русское название → внутренний ключ */
const BY_LABEL = new Map<string, keyof ProposalTemplateValues>([
  ...(
    Object.entries(PLACEHOLDER_LABELS) as [
      keyof ProposalTemplateValues,
      string,
    ][]
  ).map(
    ([key, label]) =>
      [normalize(label), key] as [string, keyof ProposalTemplateValues],
  ),
  ...(
    Object.entries(ALIASES) as [string, keyof ProposalTemplateValues][]
  ).map(([label, key]) => [normalize(label), key] as [string, keyof ProposalTemplateValues]),
]);

/** Какому значению соответствует то, что человек написал в скобках */
function resolveKey(token: string): keyof ProposalTemplateValues | null {
  const byLabel = BY_LABEL.get(normalize(token));
  if (byLabel) return byLabel;
  // старое английское название: оно осталось в части шаблонов
  const raw = token.trim();
  if (raw in PLACEHOLDER_LABELS) return raw as keyof ProposalTemplateValues;
  return null;
}

/*
 * Внутри скобок теперь бывают русские буквы и пробелы, поэтому берём всё
 * до закрывающих скобок, а не только латиницу. Длину ограничиваем: без
 * ограничения незакрытая скобка в начале письма «съела» бы весь текст до
 * следующей пары в конце.
 */
const PLACEHOLDER = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g;

/**
 * Заменяет {{Имя клиента}} (или старое {{client}}) на значение из values.
 *
 * Незнакомое название даёт пустую строку — как и раньше. Скобки в письме
 * клиенту недопустимы: лучше пустое место, чем «{{Клинт}}» в предложении на
 * несколько тысяч сомони. Найти опечатку помогает образец готового КП в
 * окне правки шаблона: там незнакомая подстановка видна сразу.
 */
export function renderPlaceholders(
  text: string | null | undefined,
  values: Partial<ProposalTemplateValues>,
): string {
  if (!text) return '';
  return text.replace(PLACEHOLDER, (_match, token: string) => {
    const key = resolveKey(token);
    if (!key) return '';
    return values[key] ?? '';
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

/**
 * Сумма позиции сметы.
 *
 * Если заданы объём и цена за единицу — считаем сами. Раньше сумма бралась
 * из запроса как есть, и в КП уходила строка «1 × 1 сомони = 999 999 сомони»:
 * опечатка в одном поле превращалась в цену для клиента.
 *
 * Когда объёма или цены нет (позиция «по договорённости»), остаётся заданная
 * сумма — считать там нечего.
 */
export function itemAmount(item: ProposalItemInput): number {
  const volume = Number(item.volume ?? 0);
  const price = Number(item.unitPrice ?? 0);
  if (volume > 0 && price > 0) return Math.round(volume * price);
  return Math.max(0, Math.round(Number(item.amount ?? 0)));
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
  /**
   * Что входит в эту услугу — построчно (из справочника услуг).
   *
   * Именно из-за отсутствия этого списка КП собирали вручную в текстовом
   * редакторе: клиенту нужно видеть, что «генеральная уборка» — это мойка
   * люстр, очистка потолков и вынос мусора, а не одна строка с суммой.
   */
  includes?: string[] | null;
  /** Срок и люди по позиции: «Планируемая сдача работы 5 дней…» */
  note?: string | null;
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
    base = params.items.reduce((sum, i) => sum + itemAmount(i), 0);
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
