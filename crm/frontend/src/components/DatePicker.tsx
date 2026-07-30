import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DayPicker } from 'react-day-picker';
import { ru } from 'date-fns/locale';
import { Calendar } from 'lucide-react';
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
  placeholder?: string;
}

/** Красивый выбор даты (react-day-picker) — единый стиль CRM. */
export function DatePicker({
  value,
  onChange,
  minDate,
  placeholder = 'Выберите дату',
}: Props) {
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
        className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-navy-200 bg-white px-3.5 text-sm transition-colors hover:border-navy-400 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-100"
      >
        {/*
         * truncate обязателен: в узкой колонке подпись вроде «Выберите дату»
         * переносилась на вторую строку и кнопка вырастала вдвое, ломая ряд.
         * Фиксированная высота держит её в одну линию с соседними полями.
         */}
        <span
          className={`truncate ${selected ? 'text-navy-900' : 'text-navy-300'}`}
        >
          {selected ? fmt(selected) : placeholder}
        </span>
        <Calendar className="h-4 w-4 shrink-0 text-navy-400" />
      </button>

      {open && (
        <div
          className="absolute left-0 z-50 mt-2 rounded-2xl border border-navy-100 bg-white p-2 shadow-card"
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
