import {
  CLEANING_TYPES,
  EXTRA_SERVICES,
  MIN_ORDER_PRICE,
  type CleaningType,
  type ExtraService,
} from '../config/pricing';
import type { CalculatorState, PriceBreakdown } from '../types';

/**
 * Главная функция расчёта стоимости.
 * Уборка: площадь × ставка (по типу и степени загрязнения) + доп.услуги.
 * Мягкая мебель: посадочные места × цена за место (без доп.услуг).
 * Применяется минимальная стоимость заказа.
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
  if (type) {
    if (isFurniture) {
      const seats = Number.isFinite(state.seats) ? Math.max(0, state.seats) : 0;
      base = Math.round(seats * type.prices.light);
    } else {
      const rate = type.prices[state.dirtLevel] ?? type.prices.light;
      const area = Number.isFinite(state.area) ? Math.max(0, state.area) : 0;
      base = Math.round(area * rate);
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
  const rawTotal = base + extrasSum;
  const total = rawTotal > 0 ? Math.max(rawTotal, MIN_ORDER_PRICE) : 0;

  return { base, extras, total };
}
