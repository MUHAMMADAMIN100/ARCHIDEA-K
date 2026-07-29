import { CURRENCY } from '../config/pricing';

/** Форматирует число как цену: 12500 -> «12 500 сомони» */
export function formatPrice(value: number): string {
  return `${value.toLocaleString('ru-RU')} ${CURRENCY}`;
}

/** Форматирует число с разделителями разрядов без валюты */
export function formatNumber(value: number): string {
  return value.toLocaleString('ru-RU');
}

/**
 * Имя человека: буквы, пробел, дефис, апостроф. Без цифр.
 * То же правило действует в CRM и на сервере — заявка с «именем» из цифр
 * не должна доходить до базы.
 */
export const PERSON_NAME_RE = /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\s'’.-]{1,119}$/u;
