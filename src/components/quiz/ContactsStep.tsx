import { FieldLabel, TextInput } from './fields';
import { IconMapPin } from '../ui/icons';
import type { ContactState } from '../../types';

interface Props {
  state: ContactState;
  onChange: (next: ContactState) => void;
  errors: Partial<Record<keyof ContactState, boolean>>;
}

/** Форматирует ввод как +992 XX XXX XX XX, прочно закрепляя префикс +992. */
export function formatTjPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('992')) digits = digits.slice(3);
  digits = digits.slice(0, 9); // 9 цифр номера
  let out = '+992';
  if (digits.length) out += ' ' + digits.slice(0, 2);
  if (digits.length > 2) out += ' ' + digits.slice(2, 5);
  if (digits.length > 5) out += ' ' + digits.slice(5, 7);
  if (digits.length > 7) out += ' ' + digits.slice(7, 9);
  return out;
}

/** Девять цифр номера без кода страны — для сравнения двух полей между собой */
function phoneDigits(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('992') ? d.slice(3) : d;
}

/** Оба поля заполнены и это один и тот же номер */
export function samePhones(a: string, b: string): boolean {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  return x.length === 9 && x === y;
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
        <TextInput
          type="tel"
          inputMode="numeric"
          value={state.phone || '+992 '}
          invalid={errors.phone}
          onChange={(e) => set('phone', formatTjPhone(e.target.value))}
          onFocus={(e) => {
            if (!state.phone) set('phone', '+992 ');
            // курсор в конец
            requestAnimationFrame(() =>
              e.target.setSelectionRange(
                e.target.value.length,
                e.target.value.length,
              ),
            );
          }}
          placeholder="+992 __ ___ __ __"
          autoComplete="tel"
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
        <TextInput
          type="tel"
          inputMode="numeric"
          value={state.phone2 || '+992 '}
          invalid={errors.phone2}
          onChange={(e) => set('phone2', formatTjPhone(e.target.value))}
          onFocus={(e) => {
            if (!state.phone2) set('phone2', '+992 ');
            requestAnimationFrame(() =>
              e.target.setSelectionRange(
                e.target.value.length,
                e.target.value.length,
              ),
            );
          }}
          placeholder="+992 __ ___ __ __"
          autoComplete="tel"
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
