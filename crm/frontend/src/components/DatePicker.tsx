import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const selected = parseISO(value);
  const min = parseISO(minDate);
  const max = parseISO(maxDate);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return; // клик по самому календарю
      if (ref.current && !ref.current.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /*
   * Позицию календаря считаем сами и рисуем его через портал в body.
   *
   * Раньше он был обычным выпадающим блоком внутри поля. Внутри модалки
   * содержимое прокручивается (max-h-[90vh] overflow-y-auto), и календарь
   * этой прокруткой обрезался: в «Штрафе клинеру» и в карточке заказа
   * половина месяца уходила за край окна. В портале обрезать его нечем,
   * а положение подгоняем так, чтобы он не вылез за экран.
   */
  const CAL_W = 300;
  const CAL_H = 340;
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 6;
      const left = Math.min(
        Math.max(8, r.left),
        Math.max(8, window.innerWidth - CAL_W - 8),
      );
      // не хватает места снизу — открываем над полем
      const below = window.innerHeight - r.bottom;
      const top =
        below < CAL_H && r.top > CAL_H
          ? r.top - CAL_H - gap
          : Math.min(r.bottom + gap, window.innerHeight - CAL_H - 8);
      setPos({ top: Math.max(8, top), left });
    };
    place();
    window.addEventListener('resize', place);
    // календарь может стоять внутри прокручиваемой модалки — следим за ней тоже
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

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

      {open &&
        createPortal(
          <>
            {/* подложка: клик мимо закрывает календарь на любом устройстве */}
            <div
              className="fixed inset-0 z-[60] bg-navy-950/10 sm:bg-transparent"
              onClick={() => setOpen(false)}
            />
            <div
              ref={popRef}
              className="fixed z-[61] max-h-[85vh] w-max max-w-[calc(100vw-1rem)] overflow-auto rounded-2xl border border-navy-100 bg-white p-2 shadow-card"
              style={{
                ...rdpVars,
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
              }}
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
          </>,
          document.body,
        )}
    </div>
  );
}
