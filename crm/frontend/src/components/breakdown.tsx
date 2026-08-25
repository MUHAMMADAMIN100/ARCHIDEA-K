import type { ComponentType, ReactNode } from 'react';
import { Inbox, Star } from 'lucide-react';
import { useFetch } from '../api/hooks';
import { DetailModal, DetailStats, DetailTable } from './Drilldown';
import { FINANCE_CATEGORY_LABEL, formatPrice } from '../lib/labels';
import { formatDateTz } from '../lib/date';
import type { FinanceEntry } from '../types';

/*
 * Таблицы-разрезы аналитики (решение владельца): не «скучный список», а
 * строки с лицом — кружок с инициалами или иконка, полоска доли от итога
 * с процентом, цветной бейдж уровня, отметка лидера. Цвета — те же, что
 * во всей системе.
 */

/** Инициалы: «Аниса Мукими» → «АМ», «Ибодат» → «Иб» */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Цвет кружка — по имени, чтобы у одного человека он был всегда один */
const AVATAR_TONES = [
  'bg-brand-100 text-brand-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
  'bg-sky-100 text-sky-700',
];

function toneOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function Avatar({ name, icon: Icon }: { name: string; icon?: ComponentType<{ className?: string }> }) {
  return (
    <span
      className={`avatar-initials inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        Icon ? 'bg-navy-100 text-navy-700' : toneOf(name)
      }`}
      aria-hidden
    >
      {Icon ? <Icon className="h-4 w-4" /> : initials(name)}
    </span>
  );
}

/** Первая колонка: кружок + имя (+ звёздочка лидера) */
export function NameCell({
  name,
  icon,
  leader = false,
  sub,
}: {
  name: string;
  icon?: ComponentType<{ className?: string }>;
  leader?: boolean;
  sub?: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <Avatar name={name} icon={icon} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-navy-900">{name}</span>
          {leader && (
            <span
              data-leader
              title="Лидер за период"
              className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700"
            >
              <Star className="h-3 w-3 fill-current" />
              лидер
            </span>
          )}
        </span>
        {sub && <span className="block text-xs text-navy-600">{sub}</span>}
      </span>
    </span>
  );
}

export type ShareColor = 'brand' | 'green' | 'amber' | 'violet' | 'red';

const BAR: Record<ShareColor, string> = {
  brand: 'bg-brand-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  red: 'bg-rose-500',
};

/**
 * Сумма с полоской доли от итога таблицы и процентом: «14 982 сомони · 41 %».
 * Итог — тот же, что в строке «Итого» под таблицей, поэтому проценты
 * строк сходятся к ста.
 */
export function ShareCell({
  value,
  total,
  color = 'brand',
  format = formatPrice,
}: {
  value: number;
  total: number;
  color?: ShareColor;
  format?: (v: number) => string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const width = total > 0 ? Math.max(2, Math.min(100, (value / total) * 100)) : 0;
  return (
    <span className="share-cell ml-auto block w-full max-w-[200px]">
      <span className="flex items-baseline justify-end gap-2">
        <span className="font-semibold tabular-nums text-navy-900">{format(value)}</span>
        <span className="share-pct w-9 text-right text-[11px] tabular-nums text-navy-500" data-pct={pct}>
          {pct} %
        </span>
      </span>
      <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
        <span
          className={`share-bar block h-full rounded-full ${BAR[color]} transition-[width] duration-700 ease-out`}
          style={{ width: `${width}%` }}
        />
      </span>
    </span>
  );
}

/**
 * Бейдж уровня по проценту: ≥ 60 — зелёный, 30–59 — янтарный, ниже — красный.
 * Так конверсия и доля оплат читаются цветом раньше, чем цифрой.
 */
export function LevelBadge({ pct, suffix = '%' }: { pct: number; suffix?: string }) {
  const tone =
    pct >= 60
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : pct >= 30
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-rose-50 text-rose-700 ring-rose-200';
  return (
    <span
      className={`level-badge inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ring-1 ${tone}`}
      data-pct={pct}
    >
      {pct}
      {suffix}
    </span>
  );
}

/** Пустая таблица — с иконкой, а не одной строкой текста */
export function EmptyRows({ text }: { text: string }) {
  return (
    <div className="empty-rows flex flex-col items-center gap-2 rounded-xl border border-dashed border-navy-200 bg-navy-50/50 px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-navy-400 shadow-card">
        <Inbox className="h-5 w-5" />
      </span>
      <span className="text-sm text-navy-600">{text}</span>
    </div>
  );
}

/** Строка с наибольшим значением — лидер таблицы (если значение больше нуля) */
export function leaderOf<T>(rows: T[] | undefined, pick: (r: T) => number): T | undefined {
  if (!rows?.length) return undefined;
  let best: T | undefined;
  let max = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v > max) {
      max = v;
      best = r;
    }
  }
  return best;
}

/**
 * Расшифровка денежной плитки, за которой стоят не заказы, а операции
 * книги: «Все расходы», «ЗП и премии сотрудников», «Чистый доход».
 * Берём расходы периода из книги и, если нужно, сужаем по статьям.
 */
export function EntriesDrillModal({
  title,
  subtitle,
  from,
  to,
  categories,
  summary,
  onClose,
}: {
  title: string;
  subtitle?: string;
  from?: string;
  to?: string;
  /** только эти статьи (например, Зарплата и Премии) */
  categories?: string[];
  /** арифметика чистого дохода — сверху окна */
  summary?: { revenue: number; expenses: number; net: number };
  onClose: () => void;
}) {
  const q = new URLSearchParams({ kind: 'EXPENSE', take: '500' });
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const { data, loading } = useFetch<{ rows: FinanceEntry[]; total: number }>(
    `/finance?${q.toString()}`,
    { deps: [from, to] },
  );
  const rows = (data?.rows ?? []).filter(
    (e) => !categories || categories.includes(e.category),
  );
  const sum = rows.reduce((s, e) => s + e.amount, 0);
  const stats = summary
    ? [
        { label: 'Выручка', value: formatPrice(summary.revenue), tone: 'success' as const },
        { label: 'Расходы', value: `−${formatPrice(summary.expenses)}`, tone: 'danger' as const },
        {
          label: 'Чистый доход',
          value: formatPrice(summary.net),
          tone: summary.net >= 0 ? ('success' as const) : ('danger' as const),
        },
        { label: 'Операций', value: data ? rows.length : '…' },
      ]
    : [
        { label: 'Операций', value: data ? rows.length : '…' },
        { label: 'Сумма', value: `−${formatPrice(sum)}`, tone: 'danger' as const },
      ];
  return (
    <DetailModal
      title={title}
      subtitle={
        subtitle ?? (from && to ? `${formatDateTz(from)} — ${formatDateTz(to)}` : 'за всё время')
      }
      onClose={onClose}
    >
      <DetailStats items={stats} />
      <DetailTable
        rows={rows}
        loading={loading}
        rowKey={(e) => e.id}
        emptyText="Расходов по этому срезу за период нет"
        columns={[
          {
            key: 'date',
            header: 'Дата',
            cell: (e) => (
              <span className="whitespace-nowrap font-medium text-navy-900">
                {formatDateTz(e.date)}
              </span>
            ),
          },
          {
            key: 'title',
            header: 'Операция',
            cell: (e) => (
              <div>
                <div className="font-medium text-navy-900">{e.title}</div>
                <div className="text-xs text-navy-600">
                  {FINANCE_CATEGORY_LABEL[e.category]}
                  {e.createdByName ? ` · ${e.createdByName}` : ''}
                </div>
              </div>
            ),
          },
          {
            key: 'amount',
            header: 'Сумма',
            align: 'right',
            cell: (e) => (
              <span className="font-semibold text-rose-700">−{formatPrice(e.amount)}</span>
            ),
          },
        ]}
        footer={
          <span className="font-semibold text-rose-700" data-testid="итог-расходов">
            −{formatPrice(sum)}
          </span>
        }
      />
    </DetailModal>
  );
}
