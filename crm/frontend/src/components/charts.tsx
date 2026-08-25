import { useEffect, useState } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from 'recharts';

/** Зазор между днями: на телефоне уже, иначе столбики за 14 дней — волоски */
export function barGap(wide: boolean): string {
  return wide ? '28%' : '10%';
}

/*
 * Общий вид диаграмм аналитики и книги (решение владельца): одни цвета,
 * градиентные столбики с подписанной суммой, плавное появление, кольцо
 * вместо сплошного круга. Всё, что рисует диаграмму, берётся отсюда —
 * тогда аналитика и книга выглядят одинаково, а менять стиль можно в
 * одном месте.
 */

/** Палитра рядов: имя → цвет. По имени же строится градиент `grad-<имя>` */
export const CHART = {
  blue: '#0078c9',
  sky: '#5fb1e8',
  green: '#10b981',
  red: '#f43f5e',
  amber: '#f59e0b',
  violet: '#8b5cf6',
  teal: '#14b8a6',
} as const;

export type ChartColor = keyof typeof CHART;

/** Доли кольца — контрастные цвета, чтобы соседние сектора не сливались */
export const PIE_PALETTE: string[] = [
  CHART.blue,
  CHART.green,
  CHART.amber,
  CHART.violet,
  CHART.red,
  CHART.teal,
  CHART.sky,
];

export const AXIS_TICK = { fontSize: 12, fill: '#5fb1e8' };
export const GRID_STROKE = '#e6f3fb';
/** Подсветка колонки под курсором */
export const CURSOR_FILL = { fill: 'rgba(0, 120, 201, 0.07)' };
/** Столбики вырастают снизу при открытии страницы */
export const BAR_ANIMATION = {
  isAnimationActive: true,
  animationBegin: 80,
  animationDuration: 900,
  animationEasing: 'ease-out' as const,
};

/**
 * Градиенты для столбиков. Кладутся внутрь диаграммы один раз:
 * `{chartGradients()}`, затем `fill={gradient('blue')}`.
 *
 * Именно функция, а не компонент: Recharts рисует только «свои» и голые
 * SVG-элементы среди детей диаграммы, а вложенный React-компонент молча
 * пропускает — градиенты не создавались, и столбики со ссылкой на них
 * становились невидимыми.
 *
 * Для горизонтальных столбиков — `chartGradients(true)` и
 * `gradient('blue', true)`: у них свой набор id, иначе два направления
 * на одной странице перебивали бы друг друга (id в SVG общие на документ).
 */
export function chartGradients(horizontal = false) {
  return (
    <defs key={horizontal ? 'grad-h' : 'grad'}>
      {(Object.keys(CHART) as ChartColor[]).map((name) => (
        <linearGradient
          key={name}
          id={gradientId(name, horizontal)}
          x1="0"
          y1="0"
          x2={horizontal ? '1' : '0'}
          y2={horizontal ? '0' : '1'}
        >
          <stop offset="0%" stopColor={CHART[name]} stopOpacity={horizontal ? 0.6 : 1} />
          <stop offset="100%" stopColor={CHART[name]} stopOpacity={horizontal ? 1 : 0.55} />
        </linearGradient>
      ))}
    </defs>
  );
}

function gradientId(name: ChartColor, horizontal: boolean) {
  return horizontal ? `grad-h-${name}` : `grad-${name}`;
}

export function gradient(name: ChartColor, horizontal = false): string {
  return `url(#${gradientId(name, horizontal)})`;
}

/** Число без «сомони» — для подписи над столбиком, где место дорого */
export function shortNumber(v: number): string {
  return Math.round(v).toLocaleString('ru-RU');
}

/**
 * Подпись суммы над столбиком: `<LabelList dataKey="x" {...valueLabel()} />`.
 * Ноль не подписываем — иначе пустые дни превращаются в ряд нулей.
 */
export function valueLabel(format: (v: number) => string = shortNumber, position: 'top' | 'right' = 'top') {
  return {
    position,
    fontSize: 11,
    fontWeight: 600,
    fill: '#0a2a48',
    formatter: (v: unknown) => (typeof v === 'number' && v > 0 ? format(v) : ''),
  };
}

/**
 * Широкий экран — подписи над столбиками помещаются. На телефоне четырнадцать
 * дней по два столбика подписи наезжали бы друг на друга, там их не рисуем:
 * сумма остаётся в подсказке при касании.
 */
export function useWideScreen(minWidth = 640): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : true,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return wide;
}

interface TooltipRow {
  name?: string;
  value?: number;
  dataKey?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
}

/**
 * Единая подсказка для всех диаграмм: заголовок, строки «ряд — значение»
 * с цветной точкой. Цвет берём не из `fill` (там ссылка на градиент),
 * а по имени ряда через `colors`, либо через `colorOf` от самой строки.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  title,
  format,
  colors,
  colorOf,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string | number;
  title?: string;
  format?: (v: number, row: TooltipRow) => string;
  colors?: Record<string, string>;
  colorOf?: (row: TooltipRow) => string | undefined;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-navy-100 bg-white/95 px-3 py-2 text-xs shadow-card backdrop-blur">
      {(title ?? label) != null && (
        <div className="mb-1 font-semibold text-navy-900">{title ?? label}</div>
      )}
      {payload.map((row, i) => {
        const dot =
          colorOf?.(row) ??
          (row.dataKey != null ? colors?.[String(row.dataKey)] : undefined) ??
          (row.color && !row.color.startsWith('url(') ? row.color : '#0078c9');
        return (
          <div key={`${row.dataKey ?? i}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-navy-600">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />
              {row.name}
            </span>
            <span className="font-semibold tabular-nums text-navy-900">
              {format && typeof row.value === 'number' ? format(row.value, row) : row.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Кольцо: подпись доли снаружи — «Название · NN %» */
function renderSliceLabel(p: {
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  percent: number;
  name: string;
  index: number;
}) {
  const RAD = Math.PI / 180;
  const r = p.outerRadius + 22;
  const x = p.cx + r * Math.cos(-p.midAngle * RAD);
  const y = p.cy + r * Math.sin(-p.midAngle * RAD);
  // мелкие доли (< 4 %) подписью не загромождаем — они есть в подсказке
  if (p.percent < 0.04) return null;
  return (
    <text
      x={x}
      y={y}
      textAnchor={x > p.cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
      fill="#0a2a48"
    >
      {p.name} · {Math.round(p.percent * 100)} %
    </text>
  );
}

/** Доля под курсором — чуть шире остальных */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderActiveSlice(p: any) {
  return <Sector {...p} outerRadius={(p.outerRadius ?? 0) + 7} />;
}

/**
 * Кольцевая диаграмма долей: в центре общий итог, у долей проценты,
 * доля под курсором чуть выезжает, клик — расшифровка.
 */
export function Donut<T extends Record<string, unknown>>({
  data,
  dataKey,
  nameKey,
  caption,
  unit,
  onSelect,
  height = 280,
}: {
  data: T[];
  dataKey: keyof T & string;
  nameKey: keyof T & string;
  /** подпись под итогом в центре, например «заявок» */
  caption: string;
  /** единица для подсказки: «5 заявок · 25 %» */
  unit?: string;
  onSelect?: (row: T) => void;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + (Number(d[dataKey]) || 0), 0);
  /*
   * На телефоне подписи долей снаружи кольца не помещаются и обрезаются
   * краем карточки — там кольцо меньше, а названия с процентами уходят
   * в легенду под ним.
   */
  const wide = useWideScreen();
  const pctOf = (name: unknown) => {
    const row = data.find((d) => d[nameKey] === name);
    const v = row ? Number(row[dataKey]) || 0 : 0;
    return total ? Math.round((v / total) * 100) : 0;
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={dataKey}
          nameKey={nameKey}
          cx="50%"
          cy={wide ? '50%' : '44%'}
          innerRadius={wide ? 64 : 52}
          outerRadius={wide ? 92 : 76}
          paddingAngle={data.length > 1 ? 2 : 0}
          cornerRadius={5}
          label={wide ? (renderSliceLabel as never) : false}
          labelLine={wide ? { stroke: '#95cdf0', strokeWidth: 1 } : false}
          isAnimationActive
          animationBegin={80}
          animationDuration={900}
          animationEasing="ease-out"
          activeIndex={active ?? undefined}
          activeShape={renderActiveSlice as never}
          onMouseEnter={(_: unknown, i: number) => setActive(i)}
          onMouseLeave={() => setActive(null)}
          cursor={onSelect ? 'pointer' : undefined}
          onClick={(slice: { payload?: T }) => slice?.payload && onSelect?.(slice.payload)}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} stroke="#fff" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip
          content={
            <ChartTooltip
              format={(v, row) => {
                const pct = total ? Math.round((v / total) * 100) : 0;
                return `${v}${unit ? ` ${unit}` : ''} · ${pct} %`;
              }}
              colorOf={(row) => {
                const i = data.findIndex((d) => d === row.payload);
                return PIE_PALETTE[(i < 0 ? 0 : i) % PIE_PALETTE.length];
              }}
            />
          }
        />
        {!wide && (
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: unknown) => `${String(value)} · ${pctOf(value)} %`}
          />
        )}
        {/* итог в центре кольца */}
        <text
          x="50%"
          y={wide ? '47%' : '41%'}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={28}
          fontWeight={800}
          fill="#0a2a48"
          data-testid="кольцо-итог"
        >
          {total.toLocaleString('ru-RU')}
        </text>
        <text
          x="50%"
          y={wide ? '58%' : '51%'}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={11}
          fill="#5fb1e8"
        >
          {caption}
        </text>
      </PieChart>
    </ResponsiveContainer>
  );
}
