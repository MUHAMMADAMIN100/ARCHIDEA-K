import type { Tariff } from '../types';

/**
 * Стоимость основной работы — то же правило, что на сервере
 * (crm/backend/src/orders/order-pricing.ts, workTotalOf).
 *
 * Объект МЕНЬШЕ порога стоит фиксированную минимальную цену, от порога —
 * объём × цена за единицу (решение владельца, сентябрь 2026). Строгое
 * «меньше»: 50 м² при пороге 50 — уже по ставке.
 *
 * Считаем и в браузере, чтобы менеджер видел сумму сразу, не дожидаясь
 * ответа сервера; авторитетным остаётся сервер. Форма подставляет эту
 * цифру в «Общую сумму», и если бы она расходилась с серверной, заказ
 * помечался бы «задан вручную» и переставал пересчитываться.
 *
 * Нулевой объём под минимум не попадает: пустая карточка не должна
 * показывать 1500, пока площадь не вписали. Ручная цена за единицу минимум
 * не отменяет — минимум про сумму заказа, а не про ставку.
 */
export function minimumApplies(
  units: number,
  tariff: Pick<Tariff, 'minPrice' | 'minArea'> | null | undefined,
): boolean {
  const minPrice = Math.round(Number(tariff?.minPrice) || 0);
  const minArea = Math.round(Number(tariff?.minArea) || 0);
  return minPrice > 0 && minArea > 0 && units > 0 && units < minArea;
}

export function workTotalOf(
  units: number,
  pricePerUnit: number,
  tariff: Pick<Tariff, 'minPrice' | 'minArea'> | null | undefined,
): { total: number; minimumApplied: boolean; minPrice: number } {
  if (minimumApplies(units, tariff)) {
    const minPrice = Math.round(Number(tariff?.minPrice) || 0);
    return { total: minPrice, minimumApplied: true, minPrice };
  }
  return {
    total: Math.round(units * pricePerUnit) || 0,
    minimumApplied: false,
    minPrice: 0,
  };
}
