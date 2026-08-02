import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';

/**
 * Выбор времени в 24-часовом виде.
 *
 * Зачем свой компонент вместо системного <input type="time">: вид системного
 * поля задаёт не страница, а язык браузера. У сотрудника с английскими
 * настройками телефона там появляется «09:01 AM», у соседа по кабинету —
 * «09:01», и договориться о времени уборки по такой записи невозможно.
 * Своё поле выглядит одинаково везде: Chrome, Safari, Android, iPhone.
 *
 * Значение снаружи всегда «ЧЧ:ММ» или пустая строка — тот же формат, что
 * отдавало системное поле, поэтому вызывающий код не меняется.
 */

/** Шаг списка — полчаса: 48 строк на сутки, пальцем попадаешь с первого раза */
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
 * Доводит набранное до «ЧЧ:ММ».
 *
 * Короткий ввод понимаем по-человечески: «9» → 09:00, «930» → 09:30.
 * Заведомо невозможное подтягиваем к границе, а не стираем: набравший
 * «2575» получит 23:59 и поправит одну цифру, а не будет вводить заново.
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
  /** Подпись для читалки экрана — рядом с полем не всегда есть видимая */
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function TimePicker({
  value,
  onChange,
  ariaLabel,
  placeholder = 'чч:мм',
  className = '',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // значение поменяли снаружи (сброс формы, загрузка заказа) — показываем его
  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (wrapRef.current && !wrapRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  /*
   * Список рисуем через портал в body и позицию считаем сами — по тем же
   * причинам, что и календарь: поле стоит внутри модалки с прокруткой, и
   * обычный выпадающий блок обрезался бы её краем.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const field = wrapRef.current?.getBoundingClientRect();
      if (!field) return;
      const h = popRef.current?.offsetHeight || 240;
      const gap = 6;
      const edge = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.max(field.width, 96);
      const left = Math.max(edge, Math.min(field.left, vw - width - edge));
      const fitsBelow = vh - field.bottom >= h + gap + edge;
      const fitsAbove = field.top >= h + gap + edge;
      const top = fitsBelow
        ? field.bottom + gap
        : fitsAbove
          ? field.top - h - gap
          : Math.max(edge, vh - h - edge);
      setPos({ top, left, width });
    };
    place();
    const raf = requestAnimationFrame(() => {
      place();
      // подводим список к выбранному времени, иначе он открывается на полуночи
      popRef.current
        ?.querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: 'center' });
    });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const commit = (raw: string) => {
    const clean = normalizeTime(raw);
    setText(clean);
    if (clean !== value) onChange(clean);
  };

  /** Ближайшая строка списка — её подсвечиваем и к ней прокручиваем */
  const nearest = value ? OPTIONS.find((o) => o >= value) ?? OPTIONS[0] : null;

  return (
    <div className={`relative min-w-0 ${className}`} ref={wrapRef}>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        className="input h-11 w-full pr-9 tabular-nums"
        value={text}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => setText(formatTyping(e.target.value))}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // клик по строке списка не должен считаться уходом с поля
          if (popRef.current?.contains(e.relatedTarget as Node)) return;
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
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-0 top-0 flex h-11 w-9 items-center justify-center text-navy-600"
        aria-label="Выбрать время из списка"
      >
        <Clock className="h-4 w-4" />
      </button>

      {open &&
        createPortal(
          <>
            {/* подложка: тап мимо закрывает список на телефоне */}
            <div
              className="fixed inset-0 z-[60]"
              onMouseDown={() => setOpen(false)}
            />
            <div
              ref={popRef}
              className="fixed z-[61] max-h-[15rem] overflow-y-auto overscroll-contain rounded-xl border border-navy-100 bg-white py-1 shadow-card"
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                width: pos?.width,
                visibility: pos ? 'visible' : 'hidden',
              }}
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
                  className={`block w-full px-3 py-2 text-left text-sm tabular-nums transition-colors ${
                    t === value
                      ? 'bg-brand-500 font-semibold text-white'
                      : 'text-navy-800 hover:bg-brand-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
