import { DirtLevel } from '@prisma/client';

/**
 * Расчёт стоимости заказа (ТЗ 5).
 *
 * Правило простое: объём × цена за единицу. Объём — это площадь в м² для уборки
 * и количество посадочных мест для мойки мягкой мебели. Цена за единицу берётся
 * из услуги по степени загрязнения, но менеджер может переписать и её, и итог.
 *
 * Считаем на сервере, а не доверяем цифре из браузера: цену заказа нельзя
 * позволять задавать клиентской стороне.
 */

export interface PricingTariff {
  key: string;
  unit: string;
  hasLevels: boolean;
  priceLight: number;
  priceMedium: number;
  priceHeavy: number;
  pricePerSqm: number;
  /**
   * Минимальная цена основной работы и порог объёма (решение владельца):
   * заказ МЕНЬШЕ minArea единиц стоит ровно minPrice, от порога — объём × цена.
   * Необязательны: у услуги без порога правило не действует.
   */
  minPrice?: number | null;
  minArea?: number | null;
}

export interface PricingInput {
  /** Ключ услуги (Tariff.key) */
  serviceKey?: string | null;
  /** Площадь, м² */
  area?: number | null;
  /** Посадочные места — для мойки мягкой мебели */
  seats?: number | null;
  dirtLevel?: DirtLevel | null;
  /** Цена за единицу, если менеджер задал её вручную */
  pricePerSqm?: number | null;
  /** Выбранные доп. услуги с сайта: ключ → количество */
  extras?: Record<string, number> | null;
  /** Свои доп. услуги строками — в сумму идут только отмеченные */
  customExtras?: CustomExtra[] | null;
  /** Скидка в сомони — вычитается из суммы работ и доп. услуг */
  discount?: number | null;
  /** Сумма дополнительных ОСНОВНЫХ услуг (мульти-выбор) — уже посчитана */
  additionalWork?: number | null;
}

/**
 * Порог «крупного заказа» в сомони (решение владельца).
 *
 * Живёт здесь, а не в сервисе заказов: тем же порогом метит заявки с сайта
 * модуль обращений, и разъехавшись, эти две цифры давали бы разные метки
 * на одинаковых по сумме заказах.
 */
export const LARGE_ORDER_THRESHOLD = 5000;

/**
 * Своя доп. услуга заказа: название, цена и отметка «включить в счёт».
 *
 * Неотмеченная строка остаётся в карточке как заметка («обсуждали вынос
 * мусора»), но денег не добавляет: иначе достаточно было бы удалить строку,
 * и договорённость терялась бы.
 */
export interface CustomExtra {
  title: string;
  price: number;
  checked: boolean;
}

/** Сумма отмеченных своих доп. услуг */
export function customExtrasTotal(
  rows: CustomExtra[] | null | undefined,
): number {
  if (!rows?.length) return 0;
  const sum = rows.reduce(
    (acc, r) =>
      acc + (r?.checked ? Math.max(0, Math.round(Number(r.price) || 0)) : 0),
    0,
  );
  return Math.min(sum, 2_000_000_000);
}

/** Доп. услуга из справочника — для расчёта её вклада в сумму */
export interface PricingExtra {
  key: string;
  price: number;
  /** цена умножается на количество (например, окна) */
  hasQty: boolean;
}

export interface PricingResult {
  /** Количество единиц, за которые считаем (м² или места) */
  units: number;
  /** Единица измерения — для подписи в интерфейсе */
  unit: string;
  /** Цена за единицу, из которой сложилась сумма */
  pricePerUnit: number;
  /** Сумма основных работ: units × pricePerUnit, либо минимальная цена */
  workTotal: number;
  /**
   * Сработал минимум: объект меньше порога, и работы стоят фиксированно.
   * Нужен интерфейсу — подписать «минимальная цена» вместо «40 × 27».
   */
  minimumApplied: boolean;
  /** Минимальная цена услуги, если правило сработало (иначе 0) */
  minPrice: number;
  /** Сумма выбранных доп. услуг */
  extrasTotal: number;
  /** Стоимость до скидки: работы + доп. услуги */
  subtotal: number;
  /** Применённая скидка (не больше subtotal) */
  discount: number;
  /** Итог к оплате: subtotal − discount */
  total: number;
}

/**
 * Сумма выбранных доп. услуг.
 *
 * extras хранится как «ключ услуги → количество». Услуга без количества
 * (hasQty=false) считается один раз, даже если в данных оказалось число
 * больше единицы: иначе опечатка удваивала бы счёт.
 */
export function extrasTotal(
  extras: Record<string, number> | null | undefined,
  catalogue: PricingExtra[] | null | undefined,
): number {
  if (!extras || !catalogue?.length) return 0;
  let sum = 0;
  for (const [key, rawQty] of Object.entries(extras)) {
    const item = catalogue.find((e) => e.key === key);
    if (!item) continue; // услугу удалили из справочника — в сумму не берём
    const qty = Math.max(0, Math.round(Number(rawQty) || 0));
    if (qty === 0) continue;
    sum += item.hasQty ? item.price * qty : item.price;
  }
  return Math.min(sum, 2_000_000_000);
}

/**
 * Цена за единицу по услуге.
 *
 * Степень загрязнения на цену НЕ влияет (решение владельца): её ставят,
 * чтобы бригада понимала, насколько объект грязный, а цену назначает
 * человек. Раньше цена шла за степенью, и любое нажатие на «Среднюю» в
 * карточке затирало вписанные вручную 30 сомони тарифными 27 — владелец
 * нашёл это на заказе «Инга».
 *
 * Аргумент dirtLevel сохранён намеренно: он есть у всех вызывающих сторон,
 * и его молчаливое удаление сделало бы вызовы неотличимыми от старых.
 */
export function unitPrice(
  tariff: PricingTariff | null | undefined,
  _dirtLevel?: DirtLevel | null,
): number {
  if (!tariff) return 0;
  return tariff.priceMedium || tariff.pricePerSqm || 0;
}

/** Сколько единиц оплачивается: места для мебели, иначе площадь */
export function billableUnits(
  input: PricingInput,
  tariff?: PricingTariff | null,
): number {
  /*
   * Заказ без основной услуги — только доп. услуги: объём не оплачивается.
   * Смотрим именно на null/пустую строку; undefined значит «услуга в этом
   * расчёте не участвует», и там объём по-прежнему считается по тарифу.
   */
  if (input.serviceKey === null || input.serviceKey === '') return 0;
  const bySeats = tariff ? tariff.unit !== 'м²' : input.serviceKey === 'FURNITURE';
  const raw = bySeats ? input.seats : input.area;
  const n = Math.round(Number(raw) || 0);
  return n > 0 ? n : 0;
}

/**
 * Действует ли минимальная цена для этого объёма.
 *
 * Правило владельца (сентябрь 2026): объект МЕНЬШЕ порога стоит фиксированно,
 * сколько бы ни было метров, — а от порога и выше считается объём × цена.
 * Именно строгое «меньше»: 50 м² при пороге 50 — уже по ставке. Владелец
 * знает, что 55 м² × 27 = 1485 выходит дешевле 49 м² за 1500, и принял это.
 *
 * Нулевой объём под правило не попадает: пустая карточка не должна
 * показывать 1500 сомони, пока площадь не вписали.
 */
export function minimumApplies(
  units: number,
  tariff: PricingTariff | null | undefined,
): boolean {
  const minPrice = Math.round(Number(tariff?.minPrice) || 0);
  const minArea = Math.round(Number(tariff?.minArea) || 0);
  return minPrice > 0 && minArea > 0 && units > 0 && units < minArea;
}

/**
 * Стоимость основной работы: объём × цена за единицу, либо минимальная цена,
 * если объект меньше порога.
 *
 * Единственное место с этим правилом — по нему считают и карточка заказа,
 * и приём заявок с сайта, и смета КП. Ручная цена за единицу минимум НЕ
 * отменяет: минимум — про сумму заказа, а не про ставку. Кому нужна другая
 * сумма, вписывает итог руками («Сумма задана вручную»).
 */
export function workTotalOf(
  units: number,
  pricePerUnit: number,
  tariff: PricingTariff | null | undefined,
): { total: number; minimumApplied: boolean; minPrice: number } {
  if (minimumApplies(units, tariff)) {
    const minPrice = Math.round(Number(tariff?.minPrice) || 0);
    return { total: minPrice, minimumApplied: true, minPrice };
  }
  // ограничиваем сверху, чтобы опечатка в площади не переполнила Int
  return {
    total: Math.min(units * pricePerUnit, 2_000_000_000),
    minimumApplied: false,
    minPrice: 0,
  };
}

/**
 * Итоговый расчёт. Если менеджер задал цену за единицу вручную — берём её,
 * иначе подставляем из услуги.
 */
export function calculatePrice(
  input: PricingInput,
  tariff?: PricingTariff | null,
  extrasCatalogue?: PricingExtra[] | null,
): PricingResult {
  const units = billableUnits(input, tariff);
  const manual = Number(input.pricePerSqm);
  const pricePerUnit =
    Number.isFinite(manual) && manual > 0
      ? Math.round(manual)
      : unitPrice(tariff, input.dirtLevel);

  // основная работа: объём × цена, либо минимальная цена (объект меньше порога)
  const main = workTotalOf(units, pricePerUnit, tariff);
  const addWork = Math.max(0, Math.round(Number(input.additionalWork) || 0));
  const workTotal = Math.min(main.total + addWork, 2_000_000_000);
  /*
   * Доп. услуги считаются из СТРОК заказа. Справочник остаётся входным
   * каналом: заявка с сайта приходит списком ключей, и он превращается в
   * такие же строки при оформлении заказа (см. orders.service). Складывать
   * оба источника нельзя — одна и та же услуга посчиталась бы дважды.
   */
  const extras = input.customExtras
    ? customExtrasTotal(input.customExtras)
    : extrasTotal(input.extras, extrasCatalogue);
  const subtotal = Math.min(workTotal + extras, 2_000_000_000);

  /*
   * Скидка не может быть больше стоимости: иначе заказ уходил бы в минус
   * и портил выручку. Отрицательную скидку тоже не принимаем.
   */
  const discount = Math.min(
    Math.max(0, Math.round(Number(input.discount) || 0)),
    subtotal,
  );

  return {
    units,
    unit: tariff?.unit ?? 'м²',
    pricePerUnit,
    workTotal,
    minimumApplied: main.minimumApplied,
    minPrice: main.minPrice,
    extrasTotal: extras,
    subtotal,
    discount,
    total: subtotal - discount,
  };
}
