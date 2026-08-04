import { FieldLabel, TextInput } from './fields';
import {
  COUNTRIES,
  HOME_CODE,
  MAX_TOTAL_DIGITS,
  MIN_TOTAL_DIGITS,
  formatNational,
  fullPhone,
  phoneComplete,
} from '../../lib/phone';
import { IconMapPin } from '../ui/icons';
import type { ContactState } from '../../types';

interface Props {
  state: ContactState;
  onChange: (next: ContactState) => void;
  errors: Partial<Record<keyof ContactState, boolean>>;
}

/**
 * Номер хранится в состоянии формы полностью: «+992900000001», «+79161234567».
 * Раньше префикс «+992» был вшит в поле намертво, и человек с российским
 * номером не мог отправить заявку вовсе.
 */
export function splitPhone(raw: string): { code: string; national: string } {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return { code: HOME_CODE, national: '' };
  let best: (typeof COUNTRIES)[number] | null = null;
  for (const c of COUNTRIES) {
    if (digits.startsWith(c.code) && (!best || c.code.length > best.code.length)) {
      best = c;
    }
  }
  if (best) return { code: best.code, national: digits.slice(best.code.length) };
  return { code: digits.slice(0, 3), national: digits.slice(3) };
}

/** Оба поля заполнены и это один и тот же номер */
export function samePhones(a: string, b: string): boolean {
  const x = (a || '').replace(/\D/g, '');
  const y = (b || '').replace(/\D/g, '');
  return x.length >= MIN_TOTAL_DIGITS && x === y;
}

/** Номер введён полностью — по правилам выбранной страны */
export function phoneFilled(raw: string): boolean {
  const { code, national } = splitPhone(raw);
  return phoneComplete(code, national);
}

/** Поле телефона с выбором страны */
function PhoneField({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
}) {
  const { code, national } = splitPhone(value);
  const known = COUNTRIES.some((c) => c.code === code);

  const push = (nextCode: string, nextNational: string) =>
    onChange(fullPhone(nextCode, nextNational));

  return (
    <div className="flex gap-2">
      <select
        className="quiz-country"
        value={known ? code : 'other'}
        aria-label="Страна номера"
        onChange={(e) => {
          if (e.target.value === 'other') {
            push('', national);
            return;
          }
          push(e.target.value, national);
        }}
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            +{c.code} {c.title.split(',')[0]}
          </option>
        ))}
        <option value="other">Другая…</option>
      </select>

      {!known && (
        <TextInput
          type="tel"
          inputMode="numeric"
          value={code ? `+${code}` : '+'}
          aria-label="Код страны"
          onChange={(e) =>
            push(e.target.value.replace(/\D/g, '').slice(0, 4), national)
          }
          className="!w-24 !px-3"
        />
      )}

      <TextInput
        type="tel"
        inputMode="numeric"
        value={formatNational(national, code)}
        invalid={invalid}
        onChange={(e) =>
          push(
            code,
            e.target.value.replace(/\D/g, '').slice(0, MAX_TOTAL_DIGITS - code.length),
          )
        }
        placeholder={code === HOME_CODE ? '90 000 00 01' : 'номер телефона'}
        autoComplete="tel"
        className="!flex-1"
      />
    </div>
  );
}

export function ContactsStep({ state, onChange, errors }: Props) {
  const set = <K extends keyof ContactState>(key: K, value: ContactState[K]) =>
    onChange({ ...state, [key]: value });

  // один и тот же номер в обоих полях — подсказка объясняет, что не так
  const sameNumbers = samePhones(state.phone, state.phone2);

  return (
    <div className="quiz-stack space-y-4 sm:space-y-5">
      <div>
        <FieldLabel required>Ваше имя</FieldLabel>
        <TextInput
          value={state.name}
          invalid={errors.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Как к вам обращаться"
          autoComplete="name"
        />
      </div>

      <div>
        <FieldLabel required>Номер телефона</FieldLabel>
        <PhoneField
          value={state.phone}
          invalid={errors.phone}
          onChange={(next) => set('phone', next)}
        />
        {errors.phone && (
          <p className="quiz-hint mt-1.5 !text-red-500">
            Введите корректный номер телефона
          </p>
        )}
      </div>

      {/*
        Запасной номер НЕОБЯЗАТЕЛЕН: человек с одним телефоном не должен
        упираться в форму и бросать заявку. Поле показываем сразу, а не
        прячем за «добавить ещё» — так его заполняют заметно чаще.
      */}
      <div>
        <FieldLabel>Запасной номер</FieldLabel>
        <PhoneField
          value={state.phone2}
          invalid={errors.phone2}
          onChange={(next) => set('phone2', next)}
        />
        {errors.phone2 ? (
          <p className="quiz-hint mt-1.5 !text-red-500">
            {sameNumbers
              ? 'Укажите другой номер — этот уже вписан выше'
              : 'Введите корректный номер телефона'}
          </p>
        ) : (
          <p className="quiz-hint mt-1.5">
            Не обязательно. Позвоним на него, если по первому не дозвонимся
          </p>
        )}
      </div>

      <div>
        <FieldLabel required>Адрес объекта</FieldLabel>
        <div className="relative">
          <IconMapPin className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-navy-400" />
          <TextInput
            value={state.address}
            invalid={errors.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="Район, улица, дом, квартира"
            autoComplete="street-address"
            className="!pl-12"
          />
        </div>
      </div>

      <p className="quiz-hint pt-1">
        Нажимая «Отправить заявку», вы соглашаетесь на обработку персональных
        данных. Мы свяжемся с вами для подтверждения.
      </p>
    </div>
  );
}
