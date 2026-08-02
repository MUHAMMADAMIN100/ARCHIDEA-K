import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DayPicker } from 'react-day-picker';
import { ru } from 'date-fns/locale';
import 'react-day-picker/style.css';

function parseISO(s?: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
function toISO(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
function fmt(d?: Date): string {
  return d
    ? d.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '';
}

const rdpVars = {
  '--rdp-accent-color': '#0078c9',
  '--rdp-accent-background-color': '#e6f3fb',
  '--rdp-today-color': '#0078c9',
} as CSSProperties;

interface Props {
  value: string;
  onChange: (v: string) => void;
  minDate?: string;
}

/** Красивый выбор даты на react-day-picker (поповер, брендовые цвета). */
export function DatePickerField({ value, onChange, minDate }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = parseISO(value);
  const min = parseISO(minDate);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-navy-200 bg-white px-4 py-3 text-left transition-colors hover:border-navy-400 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-200"
      >
        <span className={selected ? 'text-navy-900' : 'text-navy-300'}>
          {selected ? fmt(selected) : 'Выберите дату'}
        </span>
        <svg
          className="h-5 w-5 shrink-0 text-navy-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div
          /* Календарь оторван от формы и перекрывает её — отсюда тень четвёртого
             уровня и короткий выезд из-под поля: видно, откуда он взялся. */
          className="animate-pop-in absolute left-0 z-40 mt-2 origin-top rounded-2xl border border-navy-100 bg-white p-2 shadow-pop"
          style={rdpVars}
        >
          <DayPicker
            mode="single"
            locale={ru}
            weekStartsOn={1}
            selected={selected}
            defaultMonth={selected ?? min ?? new Date()}
            disabled={min ? { before: min } : undefined}
            onSelect={(d) => {
              if (d) {
                onChange(toISO(d));
                setOpen(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
