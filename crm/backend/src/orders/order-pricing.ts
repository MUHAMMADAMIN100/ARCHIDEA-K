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
}

export interface PricingResult {
  /** Количество единиц, за которые считаем (м² или места) */
  units: number;
  /** Единица измерения — для подписи в интерфейсе */
  unit: string;
  /** Цена за единицу, из которой сложилась сумма */
  pricePerUnit: number;
  /** Итог: units × pricePerUnit */
  total: number;
}

/** Цена за единицу для услуги и степени загрязнения */
export function unitPrice(
  tariff: PricingTariff | null | undefined,
  dirtLevel?: DirtLevel | null,
): number {
  if (!tariff) return 0;
  if (!tariff.hasLevels) return tariff.priceMedium || tariff.pricePerSqm || 0;

  switch (dirtLevel) {
    case DirtLevel.LIGHT:
      return tariff.priceLight || tariff.priceMedium || 0;
    case DirtLevel.HEAVY:
      return tariff.priceHeavy || tariff.priceMedium || 0;
    case DirtLevel.MEDIUM:
    default:
      return tariff.priceMedium || tariff.pricePerSqm || 0;
  }
}

/** Сколько единиц оплачивается: места для мебели, иначе площадь */
export function billableUnits(
  input: PricingInput,
  tariff?: PricingTariff | null,
): number {
  const bySeats = tariff ? tariff.unit !== 'м²' : input.serviceKey === 'FURNITURE';
  const raw = bySeats ? input.seats : input.area;
  const n = Math.round(Number(raw) || 0);
  return n > 0 ? n : 0;
}

/**
 * Итоговый расчёт. Если менеджер задал цену за единицу вручную — берём её,
 * иначе подставляем из услуги.
 */
export function calculatePrice(
  input: PricingInput,
  tariff?: PricingTariff | null,
): PricingResult {
  const units = billableUnits(input, tariff);
  const manual = Number(input.pricePerSqm);
  const pricePerUnit =
    Number.isFinite(manual) && manual > 0
      ? Math.round(manual)
      : unitPrice(tariff, input.dirtLevel);

  // ограничиваем сверху, чтобы опечатка в площади не переполнила Int
  const total = Math.min(units * pricePerUnit, 2_000_000_000);

  return {
    units,
    unit: tariff?.unit ?? 'м²',
    pricePerUnit,
    total,
  };
}
