import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';

/*
 * «Живые» элементы дашборда и финансов (решение владельца): цифры плиток
 * набегают при загрузке, у плитки — иконка в цветном кружке и цветная
 * полоска-акцент. Цвета — те же, что во всей системе; меняется только
 * форма и движение. Анимация сдержанная: 700 мс на цифру, при системной
 * настройке «меньше движения» — без анимации.
 */

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Число, которое плавно «набегает» от прошлого значения к новому.
 * Формат (например «12 345 сомони») задаёт вызывающий — компонент только
 * двигает цифру.
 */
export function AnimatedNumber({
  value,
  format = (v) => Math.round(v).toLocaleString('ru-RU'),
  duration = 700,
}: {
  value: number;
  format?: (v: number) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // быстро стартует, мягко тормозит
      const next = begin + (value - begin) * eased;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  // финальное значение печатаем точно, промежуточные — округлённо
  return <span className="tabular-nums">{format(shown === value ? value : shown)}</span>;
}

export type TileAccent = 'brand' | 'green' | 'red' | 'amber' | 'violet' | 'ink';

/** Цвета акцента: кружок иконки, полоска сверху, цифра */
const ACCENT: Record<TileAccent, { ring: string; bar: string; text: string }> = {
  brand: { ring: 'bg-brand-50 text-brand-600', bar: 'bg-brand-500', text: 'text-navy-900' },
  green: { ring: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  red: { ring: 'bg-rose-50 text-rose-600', bar: 'bg-rose-500', text: 'text-rose-700' },
  amber: { ring: 'bg-amber-50 text-amber-600', bar: 'bg-amber-500', text: 'text-navy-900' },
  violet: { ring: 'bg-violet-50 text-violet-600', bar: 'bg-violet-500', text: 'text-navy-900' },
  ink: { ring: 'bg-navy-100 text-navy-700', bar: 'bg-navy-300', text: 'text-navy-900' },
};

/**
 * Плитка-показатель: иконка, подпись, живая цифра, подсказка.
 * `size="sm"` — компактная плитка второго ряда (счётчики и мелкие суммы).
 * С `onClick` — кнопка: приподнимается под курсором, цифра ведёт в расшифровку.
 */
export function StatTile({
  label,
  number,
  format,
  value,
  hint,
  icon: Icon,
  accent = 'brand',
  size = 'lg',
  onClick,
  title,
  testId,
}: {
  label: string;
  /** число — будет анимировано */
  number?: number;
  format?: (v: number) => string;
  /** готовый текст, если анимировать нечего */
  value?: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  accent?: TileAccent;
  size?: 'lg' | 'sm';
  onClick?: () => void;
  title?: string;
  testId?: string;
}) {
  const a = ACCENT[accent];
  const small = size === 'sm';
  const shown =
    typeof number === 'number' ? <AnimatedNumber value={number} format={format} /> : value;
  const body = (
    <>
      <span className={`absolute inset-x-0 top-0 h-[3px] ${a.bar}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className={`${small ? 'text-[11px]' : 'text-xs'} uppercase tracking-wide text-navy-600`}>
          {label}
        </div>
        {Icon && (
          <span
            className={`flex shrink-0 items-center justify-center rounded-full ${a.ring} ${
              small ? 'h-7 w-7' : 'h-9 w-9'
            }`}
          >
            <Icon className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          </span>
        )}
      </div>
      <div
        className={`${small ? 'mt-1 text-xl' : 'mt-1.5 text-[22px]'} font-bold leading-tight ${a.text}`}
        data-testid={testId}
      >
        {shown}
      </div>
      {hint && <div className="mt-0.5 text-xs text-navy-600">{hint}</div>}
    </>
  );
  const base = `stat-tile relative overflow-hidden rounded-2xl border border-navy-100 bg-white ${
    small ? 'p-3' : 'p-4'
  } shadow-card`;
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? 'Показать подробности'}
      className={`press ${base} text-left transition-[box-shadow,transform,border-color] duration-160 ease-out hover:-translate-y-[3px] hover:border-navy-200 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-300`}
    >
      {body}
    </button>
  );
}
