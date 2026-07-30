import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DayPicker } from 'react-day-picker';
import { ru } from 'date-fns/locale';
import { Calendar, X } from 'lucide-react';
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

/** «12.08.2026» — там, где на месяц словом нет места (фильтры периода) */
function fmtShort(d?: Date): string {
  return d
    ? d.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
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
  maxDate?: string;
  placeholder?: string;
  /** Тесное место (фильтр периода): короткая дата и мелкий шрифт */
  compact?: boolean;
  /** Разрешить сброс даты — крестик очищает значение */
  clearable?: boolean;
}

/** Красивый выбор даты (react-day-picker) — единый стиль CRM. */
export function DatePicker({
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = 'Выберите дату',
  compact = false,
  clearable = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = parseISO(value);
  const min = parseISO(minDate);
  const max = parseISO(maxDate);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const label = selected
    ? compact
      ? fmtShort(selected)
      : fmt(selected)
    : placeholder;

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full min-w-0 items-center justify-between gap-1.5 rounded-xl border border-navy-200 bg-white transition-colors hover:border-navy-400 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-100 ${
          compact ? 'h-9 px-2.5 text-xs' : 'h-11 px-3.5 text-sm'
        }`}
      >
        {/*
         * truncate обязателен: в узкой колонке подпись вроде «Выберите дату»
         * переносилась на вторую строку и кнопка вырастала вдвое, ломая ряд.
         * Фиксированная высота держит её в одну линию с соседними полями.
         */}
        <span
          className={`truncate ${selected ? 'text-navy-900' : 'text-navy-300'}`}
        >
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {clearable && selected && (
            <X
              className="h-3.5 w-3.5 text-navy-300 hover:text-navy-600"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                setOpen(false);
              }}
            />
          )}
          <Calendar
            className={`shrink-0 text-navy-400 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
          />
        </span>
      </button>

      {open && (
        <>
          {/*
           * На телефоне календарь шириной ~300 px не влезает выпадающим списком:
           * поле может стоять у правого края, и месяц уезжает за экран. Поэтому
           * до sm он открывается по центру экрана поверх затемнения, а с планшета
           * остаётся привычным выпадающим списком под полем.
           */}
          <div
            className="fixed inset-0 z-40 bg-navy-950/10 backdrop-blur-sm sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed left-1/2 top-1/2 z-50 w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-navy-100 bg-white p-2 shadow-card sm:absolute sm:left-0 sm:top-full sm:mt-2 sm:max-w-none sm:translate-x-0 sm:translate-y-0"
            style={rdpVars}
          >
            <DayPicker
              mode="single"
              locale={ru}
              weekStartsOn={1}
              selected={selected}
              defaultMonth={selected ?? min ?? new Date()}
              disabled={
                min && max
                  ? [{ before: min }, { after: max }]
                  : min
                    ? { before: min }
                    : max
                      ? { after: max }
                      : undefined
              }
              onSelect={(d) => {
                if (d) {
                  onChange(toISO(d));
                  setOpen(false);
                }
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
