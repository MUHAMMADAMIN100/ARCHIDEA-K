import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { EmptyState, ErrorState, Spinner } from '../ui';
import { DatePicker } from '../DatePicker';
import { useFetch } from '../../api/hooks';
import {
  PERIOD_LABEL,
  PeriodPreset,
  monthRange,
  rangeOf,
  shiftMonth,
  todayISO,
} from '../../lib/date';
import type { Brigade, Cleaner, Manager } from '../../types';

/**
 * Общие элементы новых разделов (корзина, финансы, история, чек-листы, КП,
 * напоминания). Вынесены сюда, чтобы семь страниц не расползлись копипастой
 * таблиц, фильтров периода и выбора людей.
 */

// ─────────────────────────── Таблица ───────────────────────────

export interface Column<T> {
  key: string;
  title: string;
  render: (row: T) => ReactNode;
  /** Правое выравнивание — для сумм и количеств */
  numeric?: boolean;
  className?: string;
  /** Скрывать на узких экранах */
  hideOnMobile?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  onRowClick,
  perPage = 20,
  emptyText = 'Ничего не найдено',
  totals,
}: {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  perPage?: number;
  emptyText?: string;
  /** Строка итогов под таблицей */
  totals?: Partial<Record<string, ReactNode>>;
}) {
  const [page, setPage] = useState(0);
  const list = rows ?? [];

  // при смене набора данных возвращаемся на первую страницу, иначе
  // после фильтрации можно оказаться на несуществующей странице
  useEffect(() => {
    setPage(0);
  }, [list.length]);

  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const current = Math.min(page, pages - 1);
  const slice = useMemo(
    () => list.slice(current * perPage, current * perPage + perPage),
    [list, current, perPage],
  );

  if (error) return <ErrorState onRetry={onRetry} />;
  if (loading && list.length === 0) return <Spinner />;
  if (list.length === 0) return <EmptyState text={emptyText} />;

  return (
    <div className="space-y-3">
      {/*
       * Телефон: строка — карточка «подпись → значение».
       *
       * Таблица держала min-w-[640px] в горизонтальной прокрутке, поэтому на
       * экране 320–425 px любой список ездил в бок, а вместе с ним съезжала и
       * вся страница. Читать таблицу боковой прокруткой всё равно неудобно:
       * уводя взгляд к сумме, теряешь имя. Карточка показывает запись целиком.
       * Колонки, помеченные hideOnMobile, здесь не показываем — они и задуманы
       * как второстепенные.
       */}
      <div className="space-y-2 md:hidden">
        {slice.map((row) => (
          <div
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`rounded-2xl border border-navy-100 bg-white p-3 ${
              onRowClick ? 'cursor-pointer active:bg-navy-50' : ''
            }`}
          >
            {columns
              .filter((c) => !c.hideOnMobile)
              .map((c) => (
                <div
                  key={c.key}
                  className="flex items-start justify-between gap-3 border-b border-navy-50 py-1.5 last:border-0"
                >
                  {/*
                    Подпись не занимает больше половины строки, значение
                    получает гарантированную ширину: раньше значение
                    сжималось почти до нуля и текст вставал в столбик
                    по одной букве.
                  */}
                  <span className="max-w-[45%] shrink-0 text-[11px] uppercase leading-tight tracking-wide text-navy-600">
                    {c.title}
                  </span>
                  <span className="no-vertical-text flex-1 text-right text-sm text-navy-800">
                    {c.render(row)}
                  </span>
                </div>
              ))}
          </div>
        ))}
        {totals && (
          <div className="rounded-2xl border border-navy-100 bg-navy-50/60 p-3 font-semibold">
            {columns
              .filter((c) => !c.hideOnMobile && totals[c.key])
              .map((c) => (
                <div
                  key={c.key}
                  className="flex items-center justify-between gap-3 py-1 text-sm"
                >
                  <span className="text-[11px] uppercase tracking-wide text-navy-600">
                    {c.title}
                  </span>
                  <span className="tabular-nums">{totals[c.key]}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-navy-100 bg-white md:block">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-600">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-3 font-medium ${c.numeric ? 'text-right' : ''} ${
                    c.hideOnMobile ? 'hidden md:table-cell' : ''
                  }`}
                >
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-navy-50 last:border-0 ${
                  onRowClick ? 'cursor-pointer hover:bg-navy-50/60' : ''
                }`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 align-top ${c.numeric ? 'text-right tabular-nums' : ''} ${
                      c.hideOnMobile ? 'hidden md:table-cell' : ''
                    } ${c.className ?? ''}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="border-t-2 border-navy-100 bg-navy-50/50 font-semibold">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 ${c.numeric ? 'text-right tabular-nums' : ''} ${
                      c.hideOnMobile ? 'hidden md:table-cell' : ''
                    }`}
                  >
                    {totals[c.key] ?? ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-navy-600">
          <span>
            {current * perPage + 1}–
            {Math.min((current + 1) * perPage, list.length)} из {list.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="btn-ghost px-2 py-1 disabled:opacity-40"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              aria-label="Предыдущая страница"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2">
              {current + 1} / {pages}
            </span>
            <button
              className="btn-ghost px-2 py-1 disabled:opacity-40"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
              aria-label="Следующая страница"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────── Фильтр периода ──────────────────────

export interface Period {
  from: string;
  to: string;
}

export function PeriodFilter({
  value,
  onChange,
  presets = [
    'today',
    'week',
    'month',
    'prevMonth',
    'quarter',
    'year',
    'prevYear',
    'all',
  ],
  showMonthArrows = false,
}: {
  value: Period;
  onChange: (p: Period) => void;
  presets?: PeriodPreset[];
  /** Стрелки «предыдущий/следующий месяц» — для смен и выплат */
  showMonthArrows?: boolean;
}) {
  const stepMonth = (dir: number) => {
    const base = value.from || todayISO();
    onChange(monthRange(shiftMonth(base, dir)));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showMonthArrows && (
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost px-2 py-1"
            onClick={() => stepMonth(-1)}
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost px-2 py-1"
            onClick={() => stepMonth(1)}
            aria-label="Следующий месяц"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => onChange(rangeOf(p))}
            className="rounded-lg border border-navy-100 px-2.5 py-1 text-xs text-navy-600 transition hover:border-brand-300 hover:text-brand-700"
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {/*
        Свой календарь вместо родных полей браузера. Родные рисовались в локали
        системы («mm/dd/yyyy»), не поддавались сжатию и на экране 320–425 px
        вылезали за границу карточки. min-w-0 обязателен: без него flex-элемент
        не даёт себя сузить и снова распирает ряд.
      */}
      <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
        <div className="min-w-0 flex-1">
          <DatePicker
            compact
            clearable
            placeholder="с даты"
            value={value.from}
            maxDate={value.to || undefined}
            onChange={(v) => onChange({ ...value, from: v })}
          />
        </div>
        <span className="shrink-0 text-xs text-navy-600">—</span>
        <div className="min-w-0 flex-1">
          <DatePicker
            compact
            clearable
            placeholder="по дату"
            value={value.to}
            minDate={value.from || undefined}
            onChange={(v) => onChange({ ...value, to: v })}
          />
        </div>
      </div>
    </div>
  );
}

// ────────────────────── Выбор людей ──────────────────────

/**
 * Выбор клинеров. Берём только активных: уволенных назначать на выезд нельзя,
 * а раньше они оставались в списке и их продолжали выбирать.
 * Ошибку загрузки показываем явно — молчаливое «нет клинеров» при полной базе
 * было причиной бага 3.1 из ТЗ.
 */
export function CleanerPicker({
  value,
  onChange,
  single,
  groupByBrigade = true,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
  groupByBrigade?: boolean;
}) {
  const cleaners = useFetch<Cleaner[]>('/cleaners?activeOnly=true');
  const brigades = useFetch<Brigade[]>(groupByBrigade ? '/brigades' : null);

  const toggle = (id: string) => {
    if (single) {
      onChange(value.includes(id) ? [] : [id]);
      return;
    }
    onChange(
      value.includes(id) ? value.filter((x) => x !== id) : [...value, id],
    );
  };

  if (cleaners.error) {
    return (
      <ErrorState
        text="Не удалось загрузить список клинеров"
        onRetry={cleaners.reload}
      />
    );
  }
  if (cleaners.loading && !cleaners.data) return <Spinner />;

  const list = cleaners.data ?? [];
  if (list.length === 0) {
    return (
      <EmptyState text="Нет активных клинеров. Добавьте их в разделе «Команда»." />
    );
  }

  const groups = groupByBrigade
    ? [
        ...(brigades.data ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          items: list.filter((c) => c.brigadeId === b.id),
        })),
        {
          id: 'none',
          name: 'Без бригады',
          items: list.filter((c) => !c.brigadeId),
        },
      ].filter((g) => g.items.length > 0)
    : [{ id: 'all', name: '', items: list }];

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id}>
          {g.name && (
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-navy-600">
              {g.name}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((c) => {
              const active = value.includes(c.id);
              return (
                /*
                 * Выбранный клинер должен читаться с одного взгляда: состав
                 * бригады набирают быстро и на глаз. Прежняя подсветка почти не
                 * отличалась от обычного чипа, поэтому здесь голубая рамка с
                 * обводкой, заливка и галочка — три признака сразу.
                 */
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(c.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition ${
                    active
                      ? 'border-brand-500 bg-brand-100 font-medium text-brand-900 ring-2 ring-brand-200'
                      : 'border-navy-100 text-navy-600 hover:border-brand-300 hover:bg-brand-50/40'
                  }`}
                >
                  {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  {c.fullName}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Выбор сотрудника CRM (менеджера/руководителя) */
export function UserPicker({
  value,
  onChange,
  placeholder = 'Не назначен',
  onlyActive = true,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  onlyActive?: boolean;
}) {
  const { data, error, reload } = useFetch<Manager[]>('/users/assignable');

  if (error) {
    return (
      <button className="btn-ghost text-sm" onClick={reload}>
        Не удалось загрузить сотрудников — повторить
      </button>
    );
  }

  // /users/assignable уже возвращает только действующих сотрудников без клинеров
  const list = (data ?? []).filter((u) => (onlyActive ? u.isActive : true));
  return (
    <select
      className="input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {u.position ? `${u.fullName} — ${u.position}` : u.fullName}
        </option>
      ))}
    </select>
  );
}

// ────────────────────── Прочее ──────────────────────

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-navy-100">
      {items.map((i) => (
        <button
          key={i.value}
          onClick={() => onChange(i.value)}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
            i.value === value
              ? 'border-brand-500 font-medium text-brand-700'
              : 'border-transparent text-navy-600 hover:text-navy-700'
          }`}
        >
          {i.label}
          {i.badge !== undefined && i.badge > 0 && (
            <span className="rounded-full bg-navy-100 px-1.5 text-xs text-navy-600">
              {i.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Карточка-показатель. С `onClick` становится кнопкой: цифра на ней —
 * не итог, а вход в расшифровку (из каких заказов она сложилась).
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  onClick,
  title,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'positive' | 'negative';
  onClick?: () => void;
  title?: string;
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-rose-700'
        : 'text-navy-900';

  const body = (
    <>
      <div className="text-xs uppercase tracking-wide text-navy-600">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-navy-600">{hint}</div>}
    </>
  );

  if (!onClick) {
    return <div className="rounded-2xl border border-navy-100 bg-white p-4">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? 'Показать подробности'}
      className="rounded-2xl border border-navy-100 bg-white p-4 text-left transition hover:border-navy-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-300"
    >
      {body}
    </button>
  );
}

/** Поле для денежных сумм: только целые, без минусов и мусора */
export function MoneyInput({
  value,
  onChange,
  suffix = 'сомони',
  placeholder,
  disabled,
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  suffix?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        className="input pr-16"
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
          onChange(digits ? Number(digits) : 0);
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-navy-600">
        {suffix}
      </span>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Поиск',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-600" />
      <input
        className="input pl-9"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Лист для печати (ТЗ 9): на экране — обычная карточка, при печати
 * занимает страницу целиком, интерфейс вокруг скрывается.
 */
export function PrintSheet({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="print-sheet rounded-2xl border border-navy-100 bg-white p-6 sm:p-8">
      <div className="mb-5 border-b border-navy-100 pb-4">
        <div className="text-lg font-semibold text-navy-900">{title}</div>
        {subtitle && <div className="mt-1 text-sm text-navy-600">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
