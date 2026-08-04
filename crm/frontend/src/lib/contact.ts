import {
  COUNTRIES,
  HOME_CODE,
  HOME_DIGITS,
  MAX_TOTAL_DIGITS,
  MIN_TOTAL_DIGITS,
  byCode,
  countryOf,
  groupNational,
} from './countries';

/**
 * Единые правила для контактных данных в интерфейсе.
 *
 * Те же самые проверки продублированы на сервере
 * (crm/backend/src/common/validation/contact.ts) — здесь они нужны, чтобы
 * человек увидел ошибку сразу, а не после отправки формы.
 */

export const PHONE_DIGITS = HOME_DIGITS;

/**
 * Телефон хранится и передаётся в одном виде: код страны и номер подряд,
 * только цифры — «992900000001», «79161234567».
 *
 * Так же он лежит в базе: по номеру ловятся дубли клиентов и строится поиск.
 * Местный номер из девяти цифр по-прежнему понимается как таджикский — так
 * его набирают руками.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === HOME_DIGITS) digits = HOME_CODE + digits;
  else if (digits.length === HOME_DIGITS + 1 && digits.startsWith('0')) {
    digits = HOME_CODE + digits.slice(1);
  } else if (digits.length === HOME_DIGITS + 4 && digits.startsWith('8' + HOME_CODE)) {
    digits = digits.slice(1);
  }

  if (digits.startsWith(HOME_CODE)) {
    return digits.length === HOME_CODE.length + HOME_DIGITS ? digits : null;
  }
  if (digits.length < MIN_TOTAL_DIGITS || digits.length > MAX_TOTAL_DIGITS) {
    return null;
  }
  return digits;
}

/** Только цифры введённого значения — без кода страны его не трактуем */
export function phoneDigits(input: string | null | undefined): string {
  if (!input) return '';
  return String(input).replace(/\D/g, '').slice(0, MAX_TOTAL_DIGITS);
}

/** Национальная часть номера страны: «90 000 00 01» */
export function formatNational(
  national: string,
  code: string = HOME_CODE,
): string {
  const country = byCode(code);
  const groups = country?.groups ?? [3, 3, 3, 3];
  return groupNational(national.replace(/\D/g, ''), groups);
}

/** Совместимость со старым именем: национальная часть таджикского номера */
export function formatPhoneInput(input: string | null | undefined): string {
  return formatNational(phoneDigits(input));
}

/** «+992 90 000 00 01» — для карточек и списков */
export function formatPhone(input: string | null | undefined): string {
  const n = normalizePhone(input);
  if (!n) {
    const raw = phoneDigits(input);
    return raw ? `+${raw}` : '—';
  }
  const country = countryOf(n);
  if (!country) return `+${n}`;
  return `+${country.code} ${groupNational(n.slice(country.code.length), country.groups)}`;
}

/**
 * Разбирает номер на код страны и национальную часть.
 *
 * Нужен полю ввода: человек правит номер, а не строку целиком, и код страны
 * у него отдельным списком. Незнакомый код остаётся кодом — просто вводится
 * руками.
 */
export function splitPhone(input: string | null | undefined): {
  code: string;
  national: string;
} {
  const digits = phoneDigits(input);
  if (!digits) return { code: HOME_CODE, national: '' };
  const country = countryOf(digits);
  if (country) {
    return { code: country.code, national: digits.slice(country.code.length) };
  }
  /*
   * Код неизвестен. Берём первые три цифры как код — большинство кодов вне
   * списка трёхзначные, а человек всё равно поправит их руками.
   */
  return { code: digits.slice(0, 3), national: digits.slice(3) };
}

/** Ссылка для звонка и мессенджеров: только цифры с кодом страны */
export function phoneHref(input: string | null | undefined): string {
  const n = normalizePhone(input);
  return n ? `+${n}` : `+${phoneDigits(input)}`;
}

export function isValidPhone(input: string | null | undefined): boolean {
  return normalizePhone(input) !== null;
}

/**
 * ФИО человека: буквы, пробел, дефис, апостроф, точка. Без цифр.
 *
 * Правило НЕ применяется к полю «Клиент / объект» в платёжной ведомости —
 * туда пишут адреса вида «ЖК Сомони 12».
 */
/*
 * Проверки на «только буквы» больше нет (решение владельца).
 *
 * Раньше поле резало цифры прямо во время набора и не давало сохранить
 * «Тест клиент 2» или «ЖК Сомони 12». В работе имена бывают какими угодно:
 * с номером квартиры, с цифрой в названии компании. Осталась одна проверка —
 * длина: пустое имя и простыня на тысячу знаков одинаково бесполезны.
 */
export function isValidPersonName(input: string | null | undefined): boolean {
  const v = (input ?? '').trim();
  return v.length >= 2 && v.length <= 120;
}

/** Обрезает слишком длинный ввод — больше ничего не трогаем */
export function sanitizePersonName(input: string): string {
  return input.slice(0, 120);
}

/** Текст ошибки под полем — null, если всё в порядке */
/**
 * Текст ошибки под полем телефона.
 *
 * Считаем по выбранной стране: у Таджикистана длина известна точно, у чужой
 * страны проверяем только, что номер похож на телефон. Отказать настоящему
 * клиенту хуже, чем принять непривычный номер.
 */
export function phoneError(
  national: string,
  required = true,
  code: string = HOME_CODE,
): string | null {
  const d = phoneDigits(national);
  if (!d) return required ? 'Укажите номер телефона' : null;

  const country = byCode(code);
  if (country?.digits) {
    if (d.length < country.digits) {
      return `Нужно ${country.digits} цифр, введено ${d.length}`;
    }
    if (d.length > country.digits) {
      return `Слишком длинный номер: ${d.length} цифр вместо ${country.digits}`;
    }
    return null;
  }

  const total = code.length + d.length;
  if (total < MIN_TOTAL_DIGITS) return 'Слишком короткий номер';
  if (total > MAX_TOTAL_DIGITS) return 'Слишком длинный номер';
  return null;
}

/** Список стран для выпадающего списка в поле телефона */
export const PHONE_COUNTRIES = COUNTRIES;

export function nameError(input: string, required = true): string | null {
  const v = input.trim();
  if (!v) return required ? 'Укажите ФИО' : null;
  if (v.length < 2) return 'Слишком короткое имя';
  if (v.length > 120) return 'Слишком длинное имя';
  return null;
}
