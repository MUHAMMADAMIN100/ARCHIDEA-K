import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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
/**
 * «07.08.2026» — месяц числом.
 *
 * Раньше в широких полях месяц писался словом: «07 августа 2026 г.». В узкой
 * колонке заказа такая подпись не помещалась и обрезалась, а по системе
 * получалось два разных написания даты — короткое в фильтрах периода и
 * длинное во всех остальных местах. Формат теперь один.
 */
function fmt(d?: Date): string {
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
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const field = ref.current?.getBoundingClientRect();
      if (!field) return;
      const pop = popRef.current;
      /*
       * Размер берём у самого календаря, а не из константы.
       * Раньше здесь стояло 300 px «на глаз»: настоящий календарь шире, и у
       * правого края экрана он вылезал — стрелка «вперёд» уезжала за границу.
       * До первой отрисовки размеров ещё нет, поэтому подстраховываемся
       * приблизительными — на следующем кадре положение уточнится.
       */
      const w = pop?.offsetWidth || 320;
      const h = pop?.offsetHeight || 340;
      const gap = 6;
      const edge = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // по горизонтали: прижимаем к правому краю, если слева места не хватает
      const left = Math.max(edge, Math.min(field.left, vw - w - edge));

      // по вертикали: снизу не влезает — открываем над полем
      const fitsBelow = vh - field.bottom >= h + gap + edge;
      const fitsAbove = field.top >= h + gap + edge;
      const top = fitsBelow
        ? field.bottom + gap
        : fitsAbove
          ? field.top - h - gap
          : Math.max(edge, vh - h - edge);

      setPos({ top, left });
    };
    place();
    // после отрисовки календаря размеры известны — уточняем положение
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    // календарь может стоять внутри прокручиваемой модалки — следим за ней тоже
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const label = selected ? fmt(selected) : placeholder;

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
          className={`truncate ${selected ? 'text-navy-900' : 'text-navy-600'}`}
        >
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {clearable && selected && (
            <X
              className="h-3.5 w-3.5 text-navy-600 hover:text-navy-600"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                setOpen(false);
              }}
            />
          )}
          <Calendar
            className={`shrink-0 text-navy-600 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
          />
        </span>
      </button>

      {open &&
        createPortal(
          <>
            {/* подложка: клик мимо закрывает календарь на любом устройстве */}
            <div
              className="fixed inset-0 z-[60] animate-fade-in bg-navy-950/10 sm:bg-transparent"
              onClick={() => setOpen(false)}
            />
            <div
              ref={popRef}
              className="fixed z-[61] max-h-[85vh] w-max max-w-[calc(100vw-1rem)] animate-drop-in overflow-auto rounded-2xl border border-navy-100 bg-white p-2 shadow-pop"
              style={{
                ...rdpVars,
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                // до первого замера не показываем — иначе кадр мигает в углу
                visibility: pos ? 'visible' : 'hidden',
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
