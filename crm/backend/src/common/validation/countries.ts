/**
 * Страны, из которых пишут клиенты (доработка: иностранные номера).
 *
 * Короткий список вместо двух сотен строк: менеджер не должен листать весь
 * мир ради одного номера. Всё, чего нет в списке, вводится кодом вручную —
 * такие номера система принимает наравне с остальными.
 *
 * Список общий для сервера, CRM и сайта: разойдись он хоть в одном месте —
 * и один и тот же клиент завёлся бы дважды.
 */

export interface Country {
  /** Код страны без плюса: «992», «7», «1» */
  code: string;
  title: string;
  /**
   * Сколько цифр в национальном номере. null — длина не проверяется:
   * для чужой страны угадать её нельзя, а отказать настоящему клиенту хуже,
   * чем принять непривычный номер.
   */
  digits: number | null;
  /** Разбивка на группы при показе: 2-3-2-2 → «90 000 00 01» */
  groups: number[];
}

/** Родная страна: её номера проверяются строго */
export const HOME_CODE = '992';
export const HOME_DIGITS = 9;

/** Границы международного номера (E.164): код страны вместе с номером */
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

/**
 * Какой стране принадлежит номер.
 *
 * Ищем самый длинный подходящий код: «1» и «1…» не должны перехватывать
 * номера, начинающиеся с «199», если такая страна появится в списке.
 */
export function countryOf(digits: string): Country | null {
  let found: Country | null = null;
  for (const c of COUNTRIES) {
    if (digits.startsWith(c.code) && (!found || c.code.length > found.code.length)) {
      found = c;
    }
  }
  return found;
}

/** Разбивка национального номера на группы для показа человеку */
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
