import { DirtLevel } from '@prisma/client';
import { unitPrice, workTotalOf } from '../orders/order-pricing';
import type { ProposalItemInput } from './template-render';

/**
 * Смета КП из заказа (ТЗ 9).
 *
 * Раньше КП считалось по формуле «площадь × цена за м²» и умалчивало обо всём
 * остальном: доп. услуги, дополнительные основные услуги и скидка в него не
 * попадали. Клиент получал одну сумму, в CRM висела другая — и разговор
 * начинался с выяснения, какая настоящая.
 *
 * Теперь смета собирается из тех же данных, по которым посчитан сам заказ:
 * строка основной работы, строки дополнительных работ и строки доп. услуг.
 * Скидка в позиции не входит — она вычитается из итога и печатается отдельной
 * строкой, иначе вычлась бы дважды. Итог КП сходится с итогом заказа.
 */

/** Разделы сметы — по ним позиции группируются в готовом КП */
export const SECTION_WORK = 'Работы';
export const SECTION_EXTRA = 'Дополнительные услуги';

interface OrderSource {
  serviceKey: string | null;
  cleaningType: string;
  area: number | null;
  seats: number | null;
  dirtLevel: DirtLevel | null;
  pricePerSqm: number | null;
  discount: number | null;
  extras: unknown;
  customExtras?: unknown;
  additionalServices: unknown;
}

interface TariffSource {
  key: string;
  title: string;
  unit: string;
  hasLevels: boolean;
  priceLight: number;
  priceMedium: number;
  priceHeavy: number;
  pricePerSqm: number;
  /** Что входит в услугу — построчно, для состава позиции в КП */
  includedWorks?: string[];
  /** Выработка одного человека за смену — из неё считается срок работ */
  outputPerDay?: number | null;
  /** Минимальная цена и порог объёма — объект меньше порога стоит фиксированно */
  minPrice?: number | null;
  minArea?: number | null;
}

/**
 * Планируемый срок работ по позиции.
 *
 * Считается из выработки: сколько единиц успевает один человек за смену.
 * Объём 596 м² при выработке 60 м² — это 10 человеко-дней; уложить их в срок
 * можно разным числом людей, поэтому берём горизонт не больше пяти дней (так
 * составлено типовое КП компании) и добираем бригадой.
 *
 * Нет выработки в справочнике — строки не будет вовсе. Пустое «Планируемая
 * сдача работы ___ дней» в предложении клиенту хуже, чем её отсутствие.
 */
const MAX_PLAN_DAYS = 5;

export function planNote(
  volume: number,
  outputPerDay: number | null | undefined,
): string | null {
  const output = Number(outputPerDay ?? 0);
  if (!(output > 0) || !(volume > 0)) return null;

  const personDays = Math.ceil(volume / output);
  const days = Math.min(personDays, MAX_PLAN_DAYS);
  const people = Math.ceil(personDays / days);

  const dayWord = days === 1 ? 'день' : days < 5 ? 'дня' : 'дней';
  const peopleWord = people === 1 ? 'человек' : people < 5 ? 'человека' : 'человек';
  return (
    `Планируемая сдача работы ${days} ${dayWord}. ` +
    `На объекте будут работать ${people} ${peopleWord} в день.`
  );
}

interface ExtraSource {
  key: string;
  title: string;
  price: number;
  hasQty: boolean;
}

/** Снимок дополнительной основной услуги, лежащий в заказе */
interface AdditionalRow {
  key?: string;
  title?: string;
  unit?: string;
  qty?: number;
  pricePerUnit?: number;
  total?: number;
}

/**
 * Позиции сметы по заказу.
 *
 * Возвращает пустой список, если из заказа ничего не выводится — тогда
 * вызывающая сторона оставит прежнее поведение (сумма заказа одной строкой).
 */
export function itemsFromOrder(
  order: OrderSource,
  tariffs: TariffSource[],
  extrasCatalog: ExtraSource[],
): ProposalItemInput[] {
  const items: ProposalItemInput[] = [];
  const key = order.serviceKey ?? order.cleaningType;
  const tariff = tariffs.find((t) => t.key === key) ?? null;

  // ── основная работа ──
  const perSeat = tariff ? (tariff.unit ?? 'м²') !== 'м²' : false;
  const volume = perSeat ? (order.seats ?? 0) : (order.area ?? 0);
  const perUnit =
    order.pricePerSqm ?? (tariff ? unitPrice(tariff, order.dirtLevel) : 0);

  if (volume > 0 && perUnit > 0) {
    /*
     * Та же формула, что у заказа: объект меньше порога стоит минимальную
     * цену. Позиция с минимумом идёт БЕЗ цены за единицу: itemAmount
     * пересчитывает «объём × цена», и «40 м² × 27 = 1500» в КП выглядело
     * бы как ошибка в арифметике. Клиент видит «40 м² = 1500 сомони» и
     * пояснение, откуда сумма.
     */
    const work = workTotalOf(volume, perUnit, tariff);
    const plan = planNote(volume, tariff?.outputPerDay);
    const minimumNote = work.minimumApplied
      ? `Минимальная стоимость заказа до ${tariff?.minArea} ${tariff?.unit ?? 'м²'}.`
      : null;
    items.push({
      section: SECTION_WORK,
      title: tariff?.title ?? 'Уборка',
      unit: tariff?.unit ?? 'м²',
      volume,
      unitPrice: work.minimumApplied ? null : perUnit,
      amount: work.total,
      includes: tariff?.includedWorks ?? null,
      note: [minimumNote, plan].filter(Boolean).join(' ') || null,
    });
  }

  // ── дополнительные основные услуги (мульти-выбор в заказе) ──
  const additional = Array.isArray(order.additionalServices)
    ? (order.additionalServices as AdditionalRow[])
    : [];
  for (const row of additional) {
    const qty = Math.max(0, Math.round(Number(row?.qty) || 0));
    const price = Math.max(0, Math.round(Number(row?.pricePerUnit) || 0));
    if (qty <= 0 || price <= 0) continue;
    const catalog = tariffs.find((t) => t.key === row.key);
    items.push({
      section: SECTION_WORK,
      title: row.title || catalog?.title || row.key || 'Дополнительная услуга',
      unit: row.unit || catalog?.unit || 'м²',
      volume: qty,
      unitPrice: price,
      amount: qty * price,
      includes: catalog?.includedWorks ?? null,
      note: planNote(qty, catalog?.outputPerDay),
    });
  }

  /*
   * Доп. услуги, вписанные в заказ строками.
   *
   * Это основной способ: менеджер пишет название и цену прямо в форме.
   * Пока КП их не видело, состав работ терялся — а у заказа без основной
   * услуги терялось вообще всё, и клиент получал лист с одной суммой.
   */
  const custom = Array.isArray(order.customExtras)
    ? (order.customExtras as { title?: unknown; price?: unknown; checked?: unknown }[])
    : [];
  for (const row of custom) {
    if (row?.checked === false) continue;
    const title = String(row?.title ?? '').trim();
    const price = Math.max(0, Math.round(Number(row?.price) || 0));
    if (!title || price <= 0) continue;
    items.push({
      section: SECTION_EXTRA,
      title,
      unit: '',
      volume: null,
      unitPrice: price,
      amount: price,
    });
  }

  /*
   * Доп. услуги ключами из справочника — так приходит заявка с сайта.
   * Когда в заказе есть строки, список игнорируем: иначе одна и та же
   * услуга попала бы в смету дважды (то же правило, что и в расчёте цены).
   */
  if (custom.length) return items;
  const extras =
    order.extras && typeof order.extras === 'object'
      ? (order.extras as Record<string, number>)
      : {};
  for (const [extraKey, rawQty] of Object.entries(extras)) {
    const catalog = extrasCatalog.find((e) => e.key === extraKey);
    if (!catalog || catalog.price <= 0) continue;
    const qty = catalog.hasQty ? Math.max(0, Math.round(Number(rawQty) || 0)) : 1;
    if (qty <= 0) continue;
    items.push({
      section: SECTION_EXTRA,
      title: catalog.title,
      unit: catalog.hasQty ? 'шт' : '',
      volume: catalog.hasQty ? qty : null,
      unitPrice: catalog.price,
      amount: qty * catalog.price,
    });
  }

  return items;
}
