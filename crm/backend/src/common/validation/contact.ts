import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Единые правила для контактных данных во всём проекте.
 *
 * Раньше телефон и ФИО принимались как любая строка: в базу проходили
 * «1001001000ыфвфыав» и «Тест клиент1й21». Теперь правило одно и живёт здесь,
 * а не переписывается в каждой форме по-своему.
 */

/** Национальный номер Таджикистана — ровно девять цифр после кода +992 */
export const PHONE_DIGITS = 9;
export const COUNTRY_CODE = '992';

/**
 * Приводит любой ввод к каноническому виду: девять цифр без кода страны.
 *
 * Единый вид важен для защиты от дублей: с сайта номер приходит как
 * «992900000001», а руками его вбивают как «90 000 00 01» — без нормализации
 * это два разных клиента с одним и тем же телефоном.
 * Возвращает null, если номер не похож на таджикский.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');

  // отбрасываем код страны в любом из привычных написаний: +992, 992, 8992
  if (digits.length > PHONE_DIGITS && digits.startsWith(COUNTRY_CODE)) {
    digits = digits.slice(COUNTRY_CODE.length);
  } else if (digits.length === PHONE_DIGITS + 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return digits.length === PHONE_DIGITS ? digits : null;
}

/** Человеку показываем номер в привычном виде: +992 90 000 00 01 */
export function formatPhone(phone: string | null | undefined): string {
  const n = normalizePhone(phone);
  if (!n) return phone ?? '';
  return `+${COUNTRY_CODE} ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
}

export function isValidPhone(input: string | null | undefined): boolean {
  return normalizePhone(input) !== null;
}

/**
 * ФИО человека: буквы (кириллица или латиница), пробел, дефис, апостроф, точка.
 *
 * Цифры запрещены сознательно — это имя человека, а не название объекта.
 * Для поля «Клиент / объект» в платёжной ведомости правило НЕ применяется:
 * туда пишут адреса вида «ЖК Сомони 12».
 */
const NAME_RE = /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\s'’.\-]*$/u;

export function isValidPersonName(input: string | null | undefined): boolean {
  const v = (input ?? '').trim();
  if (v.length < 2 || v.length > 120) return false;
  return NAME_RE.test(v);
}

/** Номер телефона: ровно девять цифр, код страны можно писать или не писать */
export function IsTjPhone(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isTjPhone',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === '') return true;
          return typeof value === 'string' && isValidPhone(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property}: укажите номер из 9 цифр, например +992 90 000 00 01`;
        },
      },
    });
  };
}

/** ФИО: только буквы, пробелы и дефисы — без цифр */
export function IsPersonName(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPersonName',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === '') return true;
          return typeof value === 'string' && isValidPersonName(value);
        },
        defaultMessage() {
          return 'ФИО может содержать только буквы, пробел и дефис — без цифр';
        },
      },
    });
  };
}
