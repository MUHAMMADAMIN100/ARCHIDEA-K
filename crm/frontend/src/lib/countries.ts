/**
 * Страны, из которых пишут клиенты (доработка: иностранные номера).
 *
 * Копия справочника с сервера
 * (crm/backend/src/common/validation/countries.ts). Разойдись они хоть в
 * одном значении — интерфейс принимал бы номер, который сервер отвергает,
 * или наоборот.
 */

export interface Country {
  /** Код страны без плюса */
  code: string;
  title: string;
  /** Длина национального номера; null — не проверяем */
  digits: number | null;
  /** Разбивка при показе: 2-3-2-2 → «90 000 00 01» */
  groups: number[];
}

export const HOME_CODE = '992';
export const HOME_DIGITS = 9;

/** Границы международного номера (E.164) вместе с кодом страны */
export const MIN_TOTAL_DIGITS = 7;
export const MAX_TOTAL_DIGITS = 15;

export const COUNTRIES: Country[] = [
  { code: '992', title: 'Таджикистан', digits: 9, groups: [2, 3, 2, 2] },
  { code: '7', title: 'Россия, Казахстан', digits: 10, groups: [3, 3, 2, 2] },
  { code: '998', title: 'Узбекистан', digits: 9, groups: [2, 3, 2, 2] },
  { code: '996', title: 'Киргизия', digits: 9, groups: [3, 3, 3] },
  { code: '90', title: 'Турция', digits: 10, groups: [3, 3, 2, 2] },
  { code: '971', title: 'ОАЭ', digits: 9, groups: [2, 3, 4] },
  { code: '86', title: 'Китай', digits: 11, groups: [3, 4, 4] },
  { code: '1', title: 'США, Канада', digits: 10, groups: [3, 3, 4] },
];

/** Какой стране принадлежит номер: берём самый длинный подходящий код */
export function countryOf(digits: string): Country | null {
  let found: Country | null = null;
  for (const c of COUNTRIES) {
    if (digits.startsWith(c.code) && (!found || c.code.length > found.code.length)) {
      found = c;
    }
  }
  return found;
}

/** Разбивка национального номера на группы */
export function groupNational(national: string, groups: number[]): string {
  const parts: string[] = [];
  let rest = national;
  for (const size of groups) {
    if (!rest) break;
    parts.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean).join(' ');
}

/** Страна по коду — для выпадающего списка */
export function byCode(code: string): Country | null {
  return COUNTRIES.find((c) => c.code === code) ?? null;
}
