import type { ReactNode } from 'react';
import { Modal, Spinner, EmptyState } from './ui';

/*
 * Общий механизм детализации («drill-down»).
 *
 * Правило по всему кабинету: любая сводная цифра — ячейка таблицы, счётчик
 * в карточке, столбик диаграммы — не тупик, а ссылка. Клик открывает модалку
 * с расшифровкой: из чего именно эта цифра сложилась.
 *
 * Здесь лежат только примитивы оформления и разметки. Что показывать внутри
 * модалки, решает конкретный экран — он же и грузит данные.
 */

/**
 * Кликабельное значение внутри таблицы или карточки.
 *
 * Оформлено пунктиром, а не сплошной ссылкой: в плотной таблице сплошное
 * подчёркивание каждой цифры превращается в рябь. Пунктир читается как
 * «здесь есть что посмотреть», но не спорит с данными.
 */
export function DrillValue({
  onClick,
  children,
  title = 'Показать подробности',
  tone = 'default',
  align = 'left',
  disabled,
  className = '',
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  tone?: 'default' | 'muted' | 'danger' | 'success' | 'strong';
  align?: 'left' | 'right';
  disabled?: boolean;
  className?: string;
}) {
  const toneClass = {
    default: 'text-navy-800 decoration-navy-300 hover:text-navy-900',
    muted: 'text-navy-500 decoration-navy-200 hover:text-navy-800',
    strong: 'font-bold text-navy-900 decoration-navy-300',
    danger: 'font-medium text-red-600 decoration-red-300 hover:text-red-700',
    success: 'font-bold text-green-700 decoration-green-300 hover:text-green-800',
  }[tone];

  // нечего расшифровывать (ноль смен, нет штрафов) — показываем как обычный текст,
  // чтобы клик не открывал заведомо пустую модалку
  if (disabled) {
    return (
      <span className={`${align === 'right' ? 'block text-right' : ''} ${className}`}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`cursor-pointer rounded underline decoration-dotted underline-offset-4 transition hover:decoration-solid focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-300 ${toneClass} ${
        align === 'right' ? 'block w-full text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Строка-подпись «Итого/сводка» внутри модалки: подпись → значение. */
export function DetailStats({
  items,
}: {
  items: { label: string; value: ReactNode; tone?: 'default' | 'danger' | 'success' }[];
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-navy-400">{s.label}</div>
          <div
            className={`mt-0.5 text-base font-bold tabular-nums ${
              s.tone === 'danger'
                ? 'text-red-600'
                : s.tone === 'success'
                  ? 'text-green-700'
                  : 'text-navy-900'
            }`}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Переключатель разделов внутри модалки (например «Смены» / «Штрафы»). */
export function DetailTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="mb-3 flex gap-1 rounded-xl bg-navy-50 p-1">
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            value === t.value
              ? 'bg-white text-navy-900 shadow-sm'
              : 'text-navy-500 hover:text-navy-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export interface DetailColumn<T> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right';
  cell: (row: T, index: number) => ReactNode;
}

/**
 * Таблица расшифровки внутри модалки.
 * Сама разбирается со спиннером, пустым списком и подвалом «Итого».
 */
export function DetailTable<T>({
  columns,
  rows,
  loading,
  emptyText = 'Нет данных за этот период',
  rowKey,
  onRowClick,
  footer,
}: {
  columns: DetailColumn<T>[];
  rows: T[] | null | undefined;
  loading?: boolean;
  emptyText?: string;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}) {
  if (loading && !rows) return <Spinner />;
  if (!rows || rows.length === 0) return <EmptyState text={emptyText} />;

  return (
    <div className="max-h-[52vh] overflow-auto rounded-xl border border-navy-100">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-navy-100 text-left text-[11px] uppercase tracking-wide text-navy-400">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-b border-navy-50 last:border-0 ${
                onRowClick ? 'cursor-pointer hover:bg-navy-50/60' : ''
              }`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 align-top ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                >
                  {c.cell(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="sticky bottom-0 bg-white">{footer}</tfoot>}
      </table>
    </div>
  );
}

/**
 * Модалка детализации: заголовок, подпись под ним и содержимое.
 * Шире обычной — внутри почти всегда таблица.
 */
export function DetailModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal open onClose={onClose} title={title} wide>
      {/*
        Отрицательного отступа здесь быть не должно: содержимое модалки
        прокручивается, и подтянутая вверх строка обрезалась краем прокрутки —
        от даты периода была видна только нижняя половина букв.
        Цвет и размер тоже подняты: светло-голубое по светлому не читалось.
      */}
      {subtitle && (
        <div className="mb-4 text-sm text-navy-600">{subtitle}</div>
      )}
      {children}
    </Modal>
  );
}
