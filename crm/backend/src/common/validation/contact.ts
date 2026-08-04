import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import {
  HOME_CODE,
  HOME_DIGITS,
  MAX_TOTAL_DIGITS,
  MIN_TOTAL_DIGITS,
  countryOf,
  groupNational,
} from './countries';

/**
 * Единые правила для контактных данных во всём проекте.
 *
 * Раньше телефон и ФИО принимались как любая строка: в базу проходили
 * «1001001000ыфвфыав» и «Тест клиент1й21». Теперь правило одно и живёт здесь,
 * а не переписывается в каждой форме по-своему.
 */

/**
 * Телефон хранится в одном виде: код страны и номер подряд, только цифры.
 * «992900000001», «79161234567», «12125550123».
 *
 * Почему так: по номеру ловятся дубли клиентов, по нему же ищут в базе и
 * строят ссылки «позвонить». Держи мы код страны отдельно или храни местные
 * номера без кода — один и тот же человек завёлся бы дважды, а поиск находил
 * бы не всё.
 *
 * Родная страна проверяется строго (девять цифр), чужие — по длине от 7 до 15
 * цифр вместе с кодом. Длину номеров всего мира не угадать, а отказать
 * настоящему клиенту хуже, чем принять непривычный номер.
 */
export const PHONE_DIGITS = HOME_DIGITS;
export const COUNTRY_CODE = HOME_CODE;

/**
 * Любой ввод → канонический вид (цифры с кодом страны) либо null.
 *
 * Девять цифр без кода по-прежнему считаются таджикским номером: так их
 * набирают руками, и так они лежат в базе со времён, когда других стран не
 * было. Ведущая «8» перед местным номером тоже отбрасывается.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  // местный номер без кода страны — дописываем свой код
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

/** Человеку показываем номер по правилам его страны: +992 90 000 00 01 */
export function formatPhone(phone: string | null | undefined): string {
  const n = normalizePhone(phone);
  if (!n) return phone ?? '';
  const country = countryOf(n);
  if (!country) return `+${n}`;
  const national = n.slice(country.code.length);
  return `+${country.code} ${groupNational(national, country.groups)}`;
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

/**
 * Номер телефона любой страны.
 *
 * Имя оставлено прежним (IsTjPhone) сознательно: декоратор стоит в двух
 * десятках мест, и переименование ради красоты — лишний повод что-то сломать.
 */
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
          return (
            `${args.property}: номер не похож на телефон. ` +
            'Для Таджикистана — 9 цифр (+992 90 000 00 01), ' +
            'для другой страны — с её кодом, например +7 916 123 45 67'
          );
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
