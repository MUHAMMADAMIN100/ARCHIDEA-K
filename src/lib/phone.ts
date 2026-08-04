/**
 * Телефон в форме заявки: любая страна, а не только Таджикистан.
 *
 * Клиенты пишут с российских, американских и других номеров. Раньше форма
 * намертво держала префикс «+992», и такой человек не мог отправить заявку
 * вовсе — а именно с заявки начинается обращение.
 *
 * Справочник совпадает с тем, что лежит в CRM
 * (crm/frontend/src/lib/countries.ts): разойдись они — сайт принимал бы
 * номер, который CRM отвергает.
 */

export interface Country {
  code: string;
  title: string;
  /** Длина национального номера; null — не проверяем */
  digits: number | null;
  groups: number[];
}

export const HOME_CODE = '992';
export const HOME_DIGITS = 9;
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

export function byCode(code: string): Country | null {
  return COUNTRIES.find((c) => c.code === code) ?? null;
}

/** Разбивка номера на группы для показа: «90 000 00 01» */
export function groupNational(national: string, groups: number[]): string {
  const parts: string[] = [];
  let rest = national.replace(/\D/g, '');
  for (const size of groups) {
    if (!rest) break;
    parts.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean).join(' ');
}

/** Национальная часть в привычном виде для выбранной страны */
export function formatNational(national: string, code: string): string {
  const country = byCode(code);
  return groupNational(national, country?.groups ?? [3, 3, 3, 3]);
}

/** Полный номер для отправки: код страны и номер подряд, только цифры */
export function fullPhone(code: string, national: string): string {
  const digits = `${code}${national}`.replace(/\D/g, '');
  return digits ? `+${digits.slice(0, MAX_TOTAL_DIGITS)}` : '';
}

/**
 * Номер заполнен полностью?
 *
 * У Таджикистана длина известна точно, у чужой страны проверяем только, что
 * номер похож на телефон: длину номеров всего мира не угадать, а отказать
 * настоящему клиенту хуже, чем принять непривычный номер.
 */
export function phoneComplete(code: string, national: string): boolean {
  const d = national.replace(/\D/g, '');
  const c = code.replace(/\D/g, '');
  // без кода страны непонятно, куда звонить, — и сервер такой номер принял бы
  // за местный: девять цифр у соседних стран тоже встречаются
  if (!c) return false;
  const country = byCode(code);
  if (country?.digits) return d.length === country.digits;
  const total = c.length + d.length;
  return total >= MIN_TOTAL_DIGITS && total <= MAX_TOTAL_DIGITS;
}
