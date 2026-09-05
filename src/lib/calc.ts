import {
  CLEANING_TYPES,
  EXTRA_SERVICES,
  type CleaningType,
  type ExtraService,
} from '../config/pricing';
import type { CalculatorState, PriceBreakdown } from '../types';

/**
 * Действует ли минимальная цена услуги для этого объёма.
 *
 * Правило владельца (сентябрь 2026): объект МЕНЬШЕ порога стоит
 * фиксированно, сколько бы ни было метров; от порога — площадь × цена.
 * Строгое «меньше»: 50 м² при пороге 50 — уже по ставке. Та же формула
 * стоит в CRM (order-pricing.ts) — сайт и CRM называют одну сумму.
 */
export function minimumApplies(units: number, type: CleaningType): boolean {
  const minPrice = Math.round(Number(type.minPrice) || 0);
  const minArea = Math.round(Number(type.minArea) || 0);
  return minPrice > 0 && minArea > 0 && units > 0 && units < minArea;
}

/**
 * Главная функция расчёта стоимости.
 * Уборка: площадь × цена услуги + доп. услуги; объект меньше порога —
 * минимальная цена услуги вместо «площадь × цена». Степень загрязнения на
 * сумму не влияет — это подсказка бригаде.
 * Мягкая мебель: посадочные места × цена за место (без доп. услуг).
 * types/extras можно передать живые (из CRM) — по умолчанию резервные.
 */
export function calculatePrice(
  state: CalculatorState,
  types: CleaningType[] = CLEANING_TYPES,
  extraServices: ExtraService[] = EXTRA_SERVICES,
): PriceBreakdown {
  const type = types.find((t) => t.id === state.cleaningTypeId);
  const isFurniture = !!type?.perSeat;

  let base = 0;
  let minimumApplied = false;
  if (type) {
    if (isFurniture) {
      const seats = Number.isFinite(state.seats) ? Math.max(0, state.seats) : 0;
      base = Math.round(seats * type.price);
    } else {
      const area = Number.isFinite(state.area) ? Math.max(0, state.area) : 0;
      if (minimumApplies(area, type)) {
        base = Math.round(Number(type.minPrice) || 0);
        minimumApplied = true;
      } else {
        base = Math.round(area * type.price);
      }
    }
  }

  // доп.услуги применимы только к уборке (не к мойке мебели)
  const extras: PriceBreakdown['extras'] = [];
  if (!isFurniture) {
    for (const service of extraServices) {
      const qty = state.extras[service.id] ?? 0;
      if (qty > 0) {
        const sum = service.price * qty;
        extras.push({
          title: service.hasQuantity
            ? `${service.title} (${qty} ${service.unit || 'шт'})`
            : service.title,
          qty,
          sum,
        });
      }
    }
  }

  const extrasSum = extras.reduce((acc, e) => acc + e.sum, 0);
  /*
   * Общего минимума заказа больше нет: минимум живёт у услуги и уже учтён
   * в base. Доп. услуги прибавляются сверху — как и в CRM.
   */
  const total = base + extrasSum;

  return { base, extras, total, minimumApplied };
}
