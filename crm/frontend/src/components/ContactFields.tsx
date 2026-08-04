import { useState } from 'react';
import {
  PHONE_COUNTRIES,
  formatNational,
  nameError,
  phoneDigits,
  phoneError,
  sanitizePersonName,
  splitPhone,
} from '../lib/contact';
import { HOME_CODE, MAX_TOTAL_DIGITS, byCode } from '../lib/countries';

/**
 * Поля контактов с проверкой ввода.
 *
 * Раньше в форму клиента можно было вписать «Тест клиент1й21» и
 * «1001001000ыфвфыав» — ни одна проверка этого не ловила. Теперь правило одно
 * на весь проект: в телефоне не может быть букв, а сам номер хранится
 * вместе с кодом страны — хоть таджикский, хоть российский.
 *
 * Ошибку показываем после того, как человек ушёл из поля, а не на первом
 * же символе — иначе форма ругается на ещё недописанное значение.
 */

/**
 * Поле телефона с выбором страны.
 *
 * Наружу отдаёт и принимает номер в одном виде: код страны и номер подряд,
 * только цифры («992900000001»). Так он лежит в базе и так же по нему ловятся
 * дубли клиентов — форме незачем знать про это что-то своё.
 *
 * Страна определяется по самому номеру: открыл карточку клиента из России —
 * в списке сразу «+7». Для страны вне короткого списка код вводится руками.
 */
export function PhoneInput({
  value,
  onChange,
  label = 'Телефон',
  required = false,
  autoFocus,
  disabled,
}: {
  /** Полный номер цифрами вместе с кодом страны */
  value: string;
  onChange: (fullDigits: string) => void;
  label?: string | null;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [touched, setTouched] = useState(false);

  /*
   * Разбираем пришедший номер на страну и национальную часть. Держим их в
   * состоянии: пока человек стирает цифры, номер перестаёт совпадать с кодом,
   * и без собственного состояния выбранная страна прыгала бы сама.
   */
  const parsed = splitPhone(value);
  const [code, setCode] = useState(parsed.code);
  const [custom, setCustom] = useState(() => !byCode(parsed.code));
  const [national, setNational] = useState(parsed.national);

  // номер пришёл извне (открыли другую карточку) — пересобираем поле
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    const next = splitPhone(value);
    setCode(next.code);
    setCustom(!byCode(next.code));
    setNational(next.national);
  }

  const error = touched ? phoneError(national, required, code) : null;
  const country = byCode(code);

  /*
   * Наружу номер уходит С ПЛЮСОМ. Плюс здесь не украшение: он говорит
   * серверу «код страны выбран человеком, догадываться не надо». Без него
   * иностранный номер ровно из девяти цифр молча стал бы таджикским.
   */
  const push = (nextCode: string, nextNational: string) => {
    const digits = `${nextCode}${nextNational}`.replace(/\D/g, '');
    onChange(digits ? `+${digits.slice(0, MAX_TOTAL_DIGITS)}` : '');
  };

  return (
    <div>
      {label && (
        <label className="label">
          {label} {required && '*'}
        </label>
      )}
      <div className="flex gap-2">
        <select
          className="input w-[7.5rem] shrink-0 px-2"
          value={custom ? 'other' : code}
          disabled={disabled}
          aria-label="Страна номера"
          onChange={(e) => {
            if (e.target.value === 'other') {
              // код очищаем: пока его не вписали, номер сохранить нельзя —
              // иначе он ушёл бы с прежней страной
              setCustom(true);
              setCode('');
              push('', national);
              return;
            }
            setCustom(false);
            setCode(e.target.value);
            push(e.target.value, national);
          }}
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              +{c.code} {c.title.split(',')[0]}
            </option>
          ))}
          <option value="other">Другая…</option>
        </select>

        {custom && (
          <div className="relative w-24 shrink-0">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-navy-600">
              +
            </span>
            <input
              className="input w-full pl-5"
              value={code}
              inputMode="numeric"
              placeholder="код"
              disabled={disabled}
              aria-label="Код страны"
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, '').slice(0, 4);
                setCode(next);
                push(next, national);
              }}
            />
          </div>
        )}

        <input
          className={`input flex-1 ${error ? 'border-rose-400 focus:border-rose-400' : ''}`}
          value={formatNational(national, code)}
          onChange={(e) => {
            const next = phoneDigits(e.target.value).slice(
              0,
              MAX_TOTAL_DIGITS - code.length,
            );
            setNational(next);
            push(code, next);
          }}
          onBlur={() => setTouched(true)}
          inputMode="numeric"
          autoComplete="tel"
          placeholder={country?.code === HOME_CODE ? '90 000 00 01' : 'номер'}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={!!error}
        />
      </div>
      {error ? (
        <div className="mt-1 animate-fade-in text-xs text-rose-700">{error}</div>
      ) : (
        <div className="mt-1 text-xs text-navy-600">
          {country?.digits
            ? `${national.length}/${country.digits} цифр`
            : `+${code} ${national.length} цифр`}
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
      {error && (
        <div className="mt-1 animate-fade-in text-xs text-rose-700">{error}</div>
      )}
    </div>
  );
}
