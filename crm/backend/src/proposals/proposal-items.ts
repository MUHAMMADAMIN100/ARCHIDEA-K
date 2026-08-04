import { DirtLevel } from '@prisma/client';
import { unitPrice } from '../orders/order-pricing';
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
    items.push({
      section: SECTION_WORK,
      title: tariff?.title ?? 'Уборка',
      unit: tariff?.unit ?? 'м²',
      volume,
      unitPrice: perUnit,
      amount: volume * perUnit,
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
    });
  }

  // ── доп. услуги (окна, духовка и т.п.) ──
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
