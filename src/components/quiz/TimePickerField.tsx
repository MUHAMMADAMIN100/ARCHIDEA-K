import { useEffect, useRef, useState } from 'react';

/**
 * Выбор времени в 24-часовом виде.
 *
 * Системное поле <input type="time"> рисует часы по языку браузера: у
 * посетителя с английскими настройками телефона там появляется «09:01 AM».
 * Задать формат странице нельзя, поэтому поле своё — выглядит одинаково
 * везде и совпадает с тем, что видит менеджер в CRM.
 *
 * Значение наружу — «ЧЧ:ММ» или пустая строка, как и у системного поля.
 */

/** Шаг списка — полчаса: короткий список, пальцем попадаешь с первого раза */
const STEP_MINUTES = 30;

const OPTIONS: string[] = Array.from(
  { length: (24 * 60) / STEP_MINUTES },
  (_, i) => {
    const total = i * STEP_MINUTES;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(
      total % 60,
    ).padStart(2, '0')}`;
  },
);

/** Пока человек печатает: 1430 → 14:30, двоеточие ставим сами */
function formatTyping(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/**
 * Доводит набранное до «ЧЧ:ММ»: «9» → 09:00, «930» → 09:30.
 * Невозможное подтягиваем к границе, а не стираем — поправить одну цифру
 * проще, чем вводить время заново.
 */
export function normalizeTime(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  let h: number;
  let m: number;
  if (digits.length <= 2) {
    h = Number(digits);
    m = 0;
  } else if (digits.length === 3) {
    h = Number(digits.slice(0, 1));
    m = Number(digits.slice(1));
  } else {
    h = Number(digits.slice(0, 2));
    m = Number(digits.slice(2, 4));
  }
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}

export function TimePickerField({ value, onChange, invalid }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // значение поменяли снаружи — показываем его
  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // открыли список — подводим его к выбранному времени
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const commit = (raw: string) => {
    const clean = normalizeTime(raw);
    setText(clean);
    if (clean !== value) onChange(clean);
  };

  /** Ближайшая строка списка — к ней прокручиваем при открытии */
  const nearest = value ? OPTIONS.find((o) => o >= value) ?? OPTIONS[0] : null;

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder="чч:мм"
        aria-label="Удобное время"
        onChange={(e) => setText(formatTyping(e.target.value))}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // нажатие на строку списка не считается уходом с поля
          if (listRef.current?.contains(e.relatedTarget as Node)) return;
          commit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(text);
            setOpen(false);
          }
          if (e.key === 'Escape') {
            setText(value);
            setOpen(false);
          }
        }}
        className={`w-full rounded-2xl border bg-white px-4 py-3 pr-11 tabular-nums text-navy-900 placeholder:text-navy-300 transition-colors focus:outline-none focus:ring-2 ${
          invalid
            ? 'border-red-400 ring-red-100'
            : 'border-navy-200 focus:border-navy-600 focus:ring-navy-200'
        }`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setOpen((o) => !o)}
        aria-label="Выбрать время из списка"
        className="press absolute right-0 top-0 flex h-full w-11 items-center justify-center text-navy-400"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          className="animate-pop-in absolute left-0 right-0 z-40 mt-2 max-h-60 origin-top overflow-y-auto overscroll-contain rounded-2xl border border-navy-100 bg-white py-1 shadow-pop"
        >
          {OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              data-selected={t === nearest}
              onMouseDown={(e) => e.preventDefault()} // не терять фокус поля
              onClick={() => {
                commit(t);
                setOpen(false);
              }}
              className={`block w-full px-4 py-2 text-left tabular-nums transition-colors ${
                t === value
                  ? 'bg-navy-500 font-semibold text-white'
                  : 'text-navy-900 hover:bg-navy-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
