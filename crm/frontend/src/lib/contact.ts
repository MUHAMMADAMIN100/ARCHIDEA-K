/**
 * Единые правила для контактных данных в интерфейсе.
 *
 * Те же самые проверки продублированы на сервере
 * (crm/backend/src/common/validation/contact.ts) — здесь они нужны, чтобы
 * человек увидел ошибку сразу, а не после отправки формы.
 */

export const PHONE_DIGITS = 9;
const COUNTRY_CODE = '992';

/**
 * Любой ввод → девять цифр национального номера.
 * Возвращает null, если номер не таджикский или неполный.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');

  if (digits.length > PHONE_DIGITS && digits.startsWith(COUNTRY_CODE)) {
    digits = digits.slice(COUNTRY_CODE.length);
  } else if (digits.length === PHONE_DIGITS + 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.length === PHONE_DIGITS ? digits : null;
}

/** Цифры номера без кода страны — то, что человек набирает в поле */
export function phoneDigits(input: string | null | undefined): string {
  if (!input) return '';
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith(COUNTRY_CODE) && digits.length > PHONE_DIGITS) {
    digits = digits.slice(COUNTRY_CODE.length);
  }
  return digits.slice(0, PHONE_DIGITS);
}

/** «90 000 00 01» — как человек привык видеть номер */
export function formatPhoneInput(input: string | null | undefined): string {
  const d = phoneDigits(input);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)];
  return parts.filter(Boolean).join(' ');
}

/** «+992 90 000 00 01» — для показа в карточках и списках */
export function formatPhone(input: string | null | undefined): string {
  const d = phoneDigits(input);
  if (!d) return '—';
  return `+${COUNTRY_CODE} ${formatPhoneInput(d)}`;
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
const NAME_RE = /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\s'’.-]*$/u;

export function isValidPersonName(input: string | null | undefined): boolean {
  const v = (input ?? '').trim();
  return v.length >= 2 && v.length <= 120 && NAME_RE.test(v);
}

/** Убирает из ввода то, чего в имени быть не может — прямо во время набора */
export function sanitizePersonName(input: string): string {
  return input.replace(/[^А-Яа-яЁёA-Za-z\s'’.-]/gu, '').slice(0, 120);
}

/** Текст ошибки под полем — null, если всё в порядке */
export function phoneError(input: string, required = true): string | null {
  const d = phoneDigits(input);
  if (!d) return required ? 'Укажите номер телефона' : null;
  if (d.length < PHONE_DIGITS) return `Нужно ${PHONE_DIGITS} цифр, введено ${d.length}`;
  return null;
}

export function nameError(input: string, required = true): string | null {
  const v = input.trim();
  if (!v) return required ? 'Укажите ФИО' : null;
  if (v.length < 2) return 'Слишком короткое имя';
  if (!isValidPersonName(v)) return 'Только буквы, пробел и дефис — без цифр';
  return null;
}
