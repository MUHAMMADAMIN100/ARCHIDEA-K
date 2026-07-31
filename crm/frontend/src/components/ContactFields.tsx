import { useState } from 'react';
import {
  PHONE_DIGITS,
  formatPhoneInput,
  nameError,
  phoneDigits,
  phoneError,
  sanitizePersonName,
} from '../lib/contact';

/**
 * Поля контактов с проверкой ввода.
 *
 * Раньше в форму клиента можно было вписать «Тест клиент1й21» и
 * «1001001000ыфвфыав» — ни одна проверка этого не ловила. Теперь правило одно
 * на весь проект: в имени не может быть цифр, в телефоне — букв, а сам номер
 * это ровно девять цифр после кода +992.
 *
 * Ошибку показываем после того, как человек ушёл из поля, а не на первом
 * же символе — иначе форма ругается на ещё недописанное значение.
 */

export function PhoneInput({
  value,
  onChange,
  label = 'Телефон',
  required = false,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (digits: string) => void;
  label?: string | null;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const error = touched ? phoneError(value, required) : null;

  return (
    <div>
      {label && (
        <label className="label">
          {label} {required && '*'}
        </label>
      )}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy-600">
          +992
        </span>
        <input
          className={`input pl-14 ${error ? 'border-rose-400 focus:border-rose-400' : ''}`}
          value={formatPhoneInput(value)}
          onChange={(e) => onChange(phoneDigits(e.target.value))}
          onBlur={() => setTouched(true)}
          inputMode="numeric"
          autoComplete="tel"
          placeholder="90 000 00 01"
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={!!error}
        />
      </div>
      {error ? (
        <div className="mt-1 text-xs text-rose-600">{error}</div>
      ) : (
        <div className="mt-1 text-xs text-navy-600">
          {phoneDigits(value).length}/{PHONE_DIGITS} цифр
        </div>
      )}
    </div>
  );
}

export function NameInput({
  value,
  onChange,
  label = 'ФИО',
  required = true,
  placeholder,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string | null;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const error = touched ? nameError(value, required) : null;

  return (
    <div>
      {label && (
        <label className="label">
          {label} {required && '*'}
        </label>
      )}
      <input
        className={`input ${error ? 'border-rose-400 focus:border-rose-400' : ''}`}
        value={value}
        // чистим прямо при наборе: цифру в имя просто не получится поставить
        onChange={(e) => onChange(sanitizePersonName(e.target.value))}
        onBlur={() => setTouched(true)}
        placeholder={placeholder ?? 'Например: Аниса Мукими'}
        autoComplete="name"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={!!error}
      />
      {error && <div className="mt-1 text-xs text-rose-600">{error}</div>}
    </div>
  );
}
