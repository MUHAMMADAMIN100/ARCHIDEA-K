import { useEffect, useMemo, useState } from 'react';
import { DatePicker } from '../components/DatePicker';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Gift, Link2, Pencil, Plus, Search, Trash2, Wallet, X } from 'lucide-react';
import { api } from '../api/client';
import { invalidate, useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorState, Modal, PageHeader } from '../components/ui';
import { DetailModal, DetailStats, DetailTable } from '../components/Drilldown';
import {
  Column,
  DataTable,
  MoneyInput,
  Period,
  PeriodFilter,
  StatCard,
  Tabs,
} from '../components/common';
import { rangeOf, todayISO, toISODate } from '../lib/date';
import { formatDateTz } from '../lib/date';
import {
  CATEGORIES_BY_KIND,
  FINANCE_CATEGORY_LABEL,
  FINANCE_KIND_COLOR,
  FINANCE_KIND_LABEL,
  formatPrice,
} from '../lib/labels';
import { nowISO, tempId, withRetry } from '../lib/util';
import { userSeesFinance } from '../types';
import type {
  Bonus,
  Cleaner,
  FinanceCategory,
  FinanceEntry,
  FinanceKind,
  FinanceSummary,
  Manager,
  Order,
} from '../types';

// ═══════════════════════════════════════════════════════════
//  Финансы, зарплаты и премии (ТЗ 7)
// ═══════════════════════════════════════════════════════════

type FinanceTabValue = 'entries' | 'bonuses';

export function Finance() {
  const { user } = useAuth();
  const [tab, setTab] = useState<FinanceTabValue>('entries');

  // Доступ проверяется и на бэкенде (NoOpsFinanceGuard + finance:view), но
  // без явной проверки здесь ops-менеджер видел бы пустой экран после 403
  // вместо понятного объяснения, почему раздел ему недоступен.
  if (!userSeesFinance(user)) {
    return (
      <div>
        <PageHeader title="Финансы" />
        <ErrorState text="Раздел финансов доступен только руководителю компании." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Финансы"
        subtitle="Доходы и расходы компании, зарплаты и премии"
      />

      <div className="mb-5">
        <Tabs
          items={[
            { value: 'entries', label: 'Операции' },
            { value: 'bonuses', label: 'Премии' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'entries' ? <EntriesTab /> : <BonusesTab />}
    </div>
  );
}

// ─────────────────────────── Вкладка «Операции» ───────────────────────────

interface FinanceListResponse {
  rows: FinanceEntry[];
  total: number;
  totals: { income: number; expense: number; profit: number };
}

interface FinanceEntryPayload {
  kind: FinanceKind;
  category: FinanceCategory;
  amount: number;
  date: string; // «ГГГГ-ММ-ДД»
  title: string;
  comment?: string;
  orderId?: string;
  clientId?: string;
}

const ALL_CATEGORIES = Object.keys(FINANCE_CATEGORY_LABEL) as FinanceCategory[];

/** Подпись под графиками: без неё неочевидно, что столбики кликабельны */
const CHART_HINT = 'Нажмите на столбик — покажем операции, из которых он сложился.';

/** Что расшифровываем: срез книги операций + как назвать модалку */
interface FinanceDrill {
  title: string;
  subtitle?: string;
  kind?: FinanceKind;
  category?: FinanceCategory;
  /** свой диапазон (например один месяц с графика); иначе — период страницы */
  from?: string;
  to?: string;
}

function EntriesTab() {
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();

  const [period, setPeriod] = useState<Period>(() => rangeOf('month'));
  const [kindFilter, setKindFilter] = useState<FinanceKind | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<FinanceCategory | ''>('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinanceEntry | null>(null);
  const [drill, setDrill] = useState<FinanceDrill | null>(null);
  const [entryDetail, setEntryDetail] = useState<FinanceEntry | null>(null);

  /**
   * Столбик помесячной динамики. Он живёт по своему месяцу, а не по периоду
   * страницы, поэтому диапазон в расшифровке задаём явно — иначе список
   * покажет не тот месяц, по которому кликнули.
   */
  const openMonth = (monthKey: string, kind: FinanceKind) => {
    const [y, m] = monthKey.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const label = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });
    setDrill({
      title: `${kind === 'INCOME' ? 'Доход' : 'Расход'} · ${label}`,
      subtitle: 'Операции за этот месяц',
      kind,
      from: `${monthKey}-01`,
      to: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
    });
  };

  const listQuery = useMemo(() => {
    const q = new URLSearchParams();
    if (period.from) q.set('from', period.from);
    if (period.to) q.set('to', period.to);
    if (kindFilter) q.set('kind', kindFilter);
    if (categoryFilter) q.set('category', categoryFilter);
    q.set('take', '200'); // компания небольшая — за период умещается в одну страницу
    return q.toString();
  }, [period.from, period.to, kindFilter, categoryFilter]);

  const {
    data,
    loading,
    error,
    reload,
    setData,
  } = useFetch<FinanceListResponse>(`/finance?${listQuery}`, {
    deps: [listQuery],
  });

  // Сводка карточек — за весь выбранный период, БЕЗ фильтра по типу/статье:
  // так «доход/расход/прибыль» сверху не меняются от переключения фильтров таблицы.
  const { data: summary, reload: reloadSummary } = useFetch<FinanceSummary>(
    `/finance/summary?${period.from ? `from=${period.from}&` : ''}${
      period.to ? `to=${period.to}` : ''
    }`,
    { deps: [period.from, period.to] },
  );

  const rows = data?.rows ?? [];

  const refreshAfterMutation = () => {
    invalidate('/finance');
    invalidate('/analytics');
    reloadSummary();
  };

  const changeKindFilter = (v: FinanceKind | '') => {
    setKindFilter(v);
    if (v && categoryFilter && !CATEGORIES_BY_KIND[v].includes(categoryFilter)) {
      setCategoryFilter('');
    }
  };

  const upsertEntry = async (payload: FinanceEntryPayload, editingId?: string) => {
    setModalOpen(false);
    setEditingEntry(null);

    if (editingId) {
      const before = rows.find((r) => r.id === editingId);
      if (!before) return;
      const optimistic: FinanceEntry = {
        ...before,
        kind: payload.kind,
        category: payload.category,
        amount: payload.amount,
        date: `${payload.date}T00:00:00.000Z`,
        title: payload.title,
        comment: payload.comment ?? null,
        orderId: payload.orderId ?? null,
        clientId: payload.clientId ?? null,
        // ручная правка авто-записи отвязывает её от источника — так же,
        // как на сервере (finance.service.ts:update)
        source: before.source === 'AUTO' ? 'MANUAL' : before.source,
      };
      setData((prev) =>
        prev ? { ...prev, rows: prev.rows.map((r) => (r.id === editingId ? optimistic : r)) } : prev,
      );
      try {
        const res = await api.patch<FinanceEntry>(`/finance/${editingId}`, payload);
        setData((prev) =>
          prev ? { ...prev, rows: prev.rows.map((r) => (r.id === editingId ? res.data : r)) } : prev,
        );
        toast.success('Операция обновлена');
      } catch (e: any) {
        toast.error(e?.response?.data?.message || 'Не удалось сохранить изменения');
        setData((prev) =>
          prev ? { ...prev, rows: prev.rows.map((r) => (r.id === editingId ? before : r)) } : prev,
        );
      } finally {
        refreshAfterMutation();
      }
      return;
    }

    const optimistic: FinanceEntry = {
      id: tempId(),
      kind: payload.kind,
      category: payload.category,
      amount: payload.amount,
      date: `${payload.date}T00:00:00.000Z`,
      title: payload.title,
      comment: payload.comment ?? null,
      source: 'MANUAL',
      orderId: payload.orderId ?? null,
      clientId: payload.clientId ?? null,
      createdByName: user?.fullName ?? null,
      createdAt: nowISO(),
    };
    setData((prev) =>
      prev
        ? { ...prev, rows: [optimistic, ...prev.rows], total: prev.total + 1 }
        : { rows: [optimistic], total: 1, totals: { income: 0, expense: 0, profit: 0 } },
    );
    toast.success('Операция добавлена');
    try {
      const res = await api.post<FinanceEntry>('/finance', payload);
      setData((prev) =>
        prev ? { ...prev, rows: prev.rows.map((r) => (r.id === optimistic.id ? res.data : r)) } : prev,
      );
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось добавить операцию');
      setData((prev) =>
        prev
          ? { ...prev, rows: prev.rows.filter((r) => r.id !== optimistic.id), total: prev.total - 1 }
          : prev,
      );
    } finally {
      refreshAfterMutation();
    }
  };

  const removeEntry = async (entry: FinanceEntry) => {
    const ok = await dialog.confirm({
      title: 'Удалить операцию?',
      message: `«${entry.title}» (${formatPrice(entry.amount)}) будет перенесена в корзину.${
        entry.source === 'AUTO'
          ? ' Это автоматическая запись — при повторном событии система создаст новую.'
          : ''
      }`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    setData((prev) =>
      prev ? { ...prev, rows: prev.rows.filter((r) => r.id !== entry.id), total: prev.total - 1 } : prev,
    );
    toast.success('Операция перенесена в корзину');
    try {
      await withRetry(() => api.delete(`/finance/${entry.id}`));
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить операцию');
      reload(); // вернуть серверное состояние
    } finally {
      refreshAfterMutation();
    }
  };

  const footIncome = rows.filter((r) => r.kind === 'INCOME').reduce((s, r) => s + r.amount, 0);
  const footExpense = rows.filter((r) => r.kind === 'EXPENSE').reduce((s, r) => s + r.amount, 0);

  const columns: Column<FinanceEntry>[] = [
    {
      key: 'date',
      title: 'Дата',
      render: (row) => <span className="whitespace-nowrap">{formatDateTz(row.date)}</span>,
    },
    {
      key: 'kind',
      title: 'Тип',
      render: (row) => (
        <Badge className={`border ${FINANCE_KIND_COLOR[row.kind]}`}>{FINANCE_KIND_LABEL[row.kind]}</Badge>
      ),
    },
    {
      key: 'category',
      title: 'Статья',
      render: (row) => FINANCE_CATEGORY_LABEL[row.category],
      hideOnMobile: true,
    },
    {
      key: 'title',
      title: 'Название',
      render: (row) => (
        <div>
          <div className="flex flex-wrap items-center gap-1.5 font-medium text-navy-900">
            {row.title}
            {row.source === 'AUTO' && (
              <Badge className="border border-sky-200 bg-sky-50 text-[10px] text-sky-700">
                Авто
              </Badge>
            )}
          </div>
          {row.comment && <div className="mt-0.5 text-xs text-navy-600">{row.comment}</div>}
        </div>
      ),
    },
    {
      key: 'amount',
      title: 'Сумма',
      numeric: true,
      render: (row) => (
        <span className={row.kind === 'INCOME' ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
          {row.kind === 'INCOME' ? '+' : '−'}
          {formatPrice(row.amount)}
        </span>
      ),
    },
    {
      key: 'order',
      title: 'Заказ',
      hideOnMobile: true,
      render: (row) =>
        row.orderId ? (
          <span
            className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-navy-600"
            title={row.orderId}
          >
            <Link2 className="h-3.5 w-3.5" />
            №{row.orderId.slice(-6).toUpperCase()}
          </span>
        ) : (
          <span className="text-navy-600">—</span>
        ),
    },
    {
      key: 'createdBy',
      title: 'Кто внёс',
      hideOnMobile: true,
      render: (row) => row.createdByName ?? '—',
    },
    {
      key: 'actions',
      title: '',
      render: (row) => (
        // клик по строке открывает расшифровку — кнопки не должны её задевать
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              setEditingEntry(row);
              setModalOpen(true);
            }}
            className="rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 hover:text-navy-700"
            title="Изменить"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => removeEntry(row)}
            className="rounded-lg p-1.5 text-navy-600 hover:bg-rose-50 hover:text-rose-600"
            title="Удалить"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Карточки сверху: доход / расход / прибыль за период */}
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Доход за период"
          value={summary ? formatPrice(summary.income) : '—'}
          tone="positive"
          title="Из каких операций сложился доход"
          onClick={() =>
            setDrill({ title: 'Доход за период', kind: 'INCOME' })
          }
        />
        <StatCard
          label="Расход за период"
          value={summary ? formatPrice(summary.expense) : '—'}
          tone="negative"
          title="Из каких операций сложился расход"
          onClick={() =>
            setDrill({ title: 'Расход за период', kind: 'EXPENSE' })
          }
        />
        <StatCard
          label="Прибыль"
          value={summary ? formatPrice(summary.profit) : '—'}
          tone={summary && summary.profit < 0 ? 'negative' : 'positive'}
          title="Все операции периода: доход минус расход"
          onClick={() =>
            setDrill({
              title: 'Прибыль за период',
              subtitle: 'Все операции: доход минус расход',
            })
          }
        />
      </div>

      {/* Разбивка по статьям за период */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-1 font-bold text-navy-900">Разбивка по статьям за период</h3>
          <p className="mb-3 text-xs text-navy-600">{CHART_HINT}</p>
          {summary && summary.byCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={summary.byCategory} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6f3fb" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#5fb1e8' }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={140}
                  tick={{ fontSize: 11, fill: '#0a2a48' }}
                />
                <Tooltip formatter={(v: number) => formatPrice(v)} />
                <Bar
                  dataKey="amount"
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(bar: any) =>
                    bar?.payload?.category &&
                    setDrill({
                      title: bar.payload.label,
                      subtitle: 'Операции по этой статье',
                      category: bar.payload.category,
                    })
                  }
                >
                  {summary.byCategory.map((c, i) => (
                    <Cell key={i} fill={c.kind === 'INCOME' ? '#10b981' : '#f43f5e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="За выбранный период операций ещё нет" />
          )}
        </div>

        <div className="card p-5">
          <h3 className="mb-1 font-bold text-navy-900">Динамика по месяцам</h3>
          <p className="mb-3 text-xs text-navy-600">{CHART_HINT}</p>
          {summary && summary.series && summary.series.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={summary.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6f3fb" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#5fb1e8' }} />
                <YAxis tick={{ fontSize: 12, fill: '#5fb1e8' }} />
                <Tooltip formatter={(v: number) => formatPrice(v)} />
                <Legend />
                <Bar
                  dataKey="income"
                  name="Доход"
                  fill="#10b981"
                  radius={[6, 6, 0, 0]}
                  cursor="pointer"
                  onClick={(bar: any) => bar?.payload?.date && openMonth(bar.payload.date, 'INCOME')}
                />
                <Bar
                  dataKey="expense"
                  name="Расход"
                  fill="#f43f5e"
                  radius={[6, 6, 0, 0]}
                  cursor="pointer"
                  onClick={(bar: any) => bar?.payload?.date && openMonth(bar.payload.date, 'EXPENSE')}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="Недостаточно данных для помесячной динамики" />
          )}
        </div>
      </div>

      {/* Лента операций */}
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-100 text-navy-700">
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <div className="font-bold text-navy-900">Книга доходов и расходов</div>
              <div className="text-xs text-navy-600">Все денежные операции компании</div>
            </div>
          </div>
          <button
            onClick={() => {
              setEditingEntry(null);
              setModalOpen(true);
            }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" />
            Добавить операцию
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <PeriodFilter value={period} onChange={setPeriod} />
          <select
            className="input max-w-[160px]"
            value={kindFilter}
            onChange={(e) => changeKindFilter(e.target.value as FinanceKind | '')}
          >
            <option value="">Все типы</option>
            <option value="INCOME">Доход</option>
            <option value="EXPENSE">Расход</option>
          </select>
          <select
            className="input max-w-[200px]"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as FinanceCategory | '')}
          >
            <option value="">Все статьи</option>
            {(kindFilter ? CATEGORIES_BY_KIND[kindFilter] : ALL_CATEGORIES).map((c) => (
              <option key={c} value={c}>
                {FINANCE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>

        <DataTable<FinanceEntry>
          columns={columns}
          rows={data?.rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={reload}
          onRowClick={setEntryDetail}
          emptyText="За выбранный период и фильтры операций нет. Доход появится автоматически при оплате заказа, либо добавьте запись вручную кнопкой выше."
          totals={
            rows.length > 0
              ? {
                  date: `Итого: ${rows.length}`,
                  amount: (
                    <span className="space-x-2 whitespace-nowrap">
                      <span className="text-emerald-600">+{formatPrice(footIncome)}</span>
                      <span className="text-rose-600">−{formatPrice(footExpense)}</span>
                    </span>
                  ),
                }
              : undefined
          }
        />
      </div>

      {modalOpen && (
        <EntryModal
          initial={editingEntry ?? undefined}
          onClose={() => {
            setModalOpen(false);
            setEditingEntry(null);
          }}
          onSubmit={upsertEntry}
        />
      )}

      {drill && (
        <FinanceDrilldownModal
          drill={drill}
          period={period}
          onPick={(entry) => {
            setDrill(null);
            setEntryDetail(entry);
          }}
          onClose={() => setDrill(null)}
        />
      )}

      {entryDetail && (
        <EntryDetailModal entry={entryDetail} onClose={() => setEntryDetail(null)} />
      )}
    </div>
  );
}

// ───────────── Расшифровка финансовых цифр ─────────────

/**
 * Список операций, из которых сложилась цифра на карточке или столбик графика.
 * Считается тем же фильтром, что и сама цифра, поэтому итог внизу сходится
 * с числом, по которому кликнули.
 */
function FinanceDrilldownModal({
  drill,
  period,
  onPick,
  onClose,
}: {
  drill: FinanceDrill;
  period: Period;
  onPick: (entry: FinanceEntry) => void;
  onClose: () => void;
}) {
  const from = drill.from ?? period.from;
  const to = drill.to ?? period.to;

  const query = new URLSearchParams({ take: '500' });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (drill.kind) query.set('kind', drill.kind);
  if (drill.category) query.set('category', drill.category);

  const { data, loading, error, reload } = useFetch<FinanceListResponse>(
    `/finance?${query.toString()}`,
    { deps: [query.toString()] },
  );

  const rows = data?.rows ?? [];
  const income = rows.filter((r) => r.kind === 'INCOME').reduce((s, r) => s + r.amount, 0);
  const expense = rows.filter((r) => r.kind === 'EXPENSE').reduce((s, r) => s + r.amount, 0);

  return (
    <DetailModal
      title={drill.title}
      subtitle={`${drill.subtitle ? `${drill.subtitle} · ` : ''}${
        from && to ? `${formatDateTz(from)} — ${formatDateTz(to)}` : 'за всё время'
      }`}
      onClose={onClose}
    >
      {error ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DetailStats
            items={[
              { label: 'Операций', value: data ? rows.length : '…' },
              { label: 'Доход', value: `+${formatPrice(income)}`, tone: 'success' },
              { label: 'Расход', value: `−${formatPrice(expense)}`, tone: 'danger' },
              {
                label: 'Итог',
                value: formatPrice(income - expense),
                tone: income - expense < 0 ? 'danger' : 'success',
              },
            ]}
          />

          <DetailTable
            rows={data?.rows}
            loading={loading}
            rowKey={(e) => e.id}
            onRowClick={onPick}
            emptyText="Операций по этому срезу нет"
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
                      {e.source === 'AUTO' ? ' · авто' : ''}
                    </div>
                  </div>
                ),
              },
              {
                key: 'amount',
                header: 'Сумма',
                align: 'right',
                cell: (e) => (
                  <span
                    className={
                      e.kind === 'INCOME'
                        ? 'font-semibold text-emerald-600'
                        : 'font-semibold text-rose-600'
                    }
                  >
                    {e.kind === 'INCOME' ? '+' : '−'}
                    {formatPrice(e.amount)}
                  </span>
                ),
              },
            ]}
            footer={
              rows.length > 0 ? (
                <tr className="border-t border-navy-100 font-bold text-navy-900">
                  <td className="px-3 py-2" colSpan={2}>
                    Итого по срезу
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatPrice(income - expense)}
                  </td>
                </tr>
              ) : undefined
            }
          />

          <p className="mt-3 text-xs text-navy-600">
            Нажмите на операцию, чтобы увидеть комментарий, привязку к заказу и автора записи.
          </p>
        </>
      )}
    </DetailModal>
  );
}

/** Одна операция целиком — включая поля, скрытые в таблице на узком экране */
function EntryDetailModal({
  entry,
  onClose,
}: {
  entry: FinanceEntry;
  onClose: () => void;
}) {
  const facts: { label: string; value: ReactNode }[] = [
    { label: 'Дата', value: formatDateTz(entry.date) },
    { label: 'Тип', value: FINANCE_KIND_LABEL[entry.kind] },
    { label: 'Статья', value: FINANCE_CATEGORY_LABEL[entry.category] },
    {
      label: 'Сумма',
      value: (
        <span
          className={
            entry.kind === 'INCOME'
              ? 'font-bold text-emerald-600'
              : 'font-bold text-rose-600'
          }
        >
          {entry.kind === 'INCOME' ? '+' : '−'}
          {formatPrice(entry.amount)}
        </span>
      ),
    },
    {
      label: 'Источник',
      value:
        entry.source === 'AUTO'
          ? 'Создана автоматически (оплата заказа)'
          : 'Внесена вручную',
    },
    { label: 'Кто внёс', value: entry.createdByName ?? '—' },
    {
      label: 'Заказ',
      value: entry.orderId ? (
        <Link
          to={`/clients/${entry.clientId ?? ''}`}
          className="text-navy-600 underline decoration-dotted underline-offset-4 hover:text-navy-900"
        >
          №{entry.orderId.slice(-6).toUpperCase()}
        </Link>
      ) : (
        '—'
      ),
    },
    { label: 'Комментарий', value: entry.comment || '—' },
  ];

  return (
    <DetailModal title={entry.title} subtitle="Полная карточка операции" onClose={onClose}>
      <dl className="divide-y divide-navy-50 rounded-xl border border-navy-100">
        {facts.map((f) => (
          <div key={f.label} className="flex gap-4 px-3 py-2.5 text-sm">
            <dt className="w-40 shrink-0 text-navy-600">{f.label}</dt>
            <dd className="min-w-0 flex-1 text-navy-900">{f.value}</dd>
          </div>
        ))}
      </dl>
    </DetailModal>
  );
}

interface OrderLink {
  id: string;
  clientId?: string;
  label: string;
}

function EntryModal({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: FinanceEntry;
  onClose: () => void;
  onSubmit: (payload: FinanceEntryPayload, editingId?: string) => void;
}) {
  const [kind, setKind] = useState<FinanceKind>(initial?.kind ?? 'EXPENSE');
  const [category, setCategory] = useState<FinanceCategory>(
    initial?.category ?? CATEGORIES_BY_KIND[initial?.kind ?? 'EXPENSE'][0],
  );
  const [amount, setAmount] = useState<number>(initial?.amount ?? 0);
  const [date, setDate] = useState(initial ? toISODate(initial.date) : todayISO());
  const [title, setTitle] = useState(initial?.title ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [order, setOrder] = useState<OrderLink | null>(
    initial?.orderId
      ? {
          id: initial.orderId,
          clientId: initial.clientId ?? undefined,
          label: `Заказ №${initial.orderId.slice(-6).toUpperCase()}`,
        }
      : null,
  );

  const availableCategories = CATEGORIES_BY_KIND[kind];

  const changeKind = (k: FinanceKind) => {
    setKind(k);
    if (!CATEGORIES_BY_KIND[k].includes(category)) {
      setCategory(CATEGORIES_BY_KIND[k][0]);
    }
  };

  const canSubmit = amount > 0 && title.trim().length > 0 && !!date;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(
      {
        kind,
        category,
        amount,
        date,
        title: title.trim(),
        comment: comment.trim() || undefined,
        orderId: order?.id,
        clientId: order?.clientId,
      },
      initial?.id,
    );
  };

  return (
    <Modal open onClose={onClose} title={initial ? 'Изменить операцию' : 'Новая операция'} wide>
      <div className="space-y-3">
        {initial?.source === 'AUTO' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Это автоматическая запись, созданная системой (например, при переходе заказа в
            «Оплачено»). Правка отвяжет её от источника: при повторном событии система создаст
            новую запись, а эта останется такой, какой вы её сохраните.
          </p>
        )}

        <div>
          <label className="label">Тип операции *</label>
          <div className="flex gap-2">
            {(['INCOME', 'EXPENSE'] as FinanceKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => changeKind(k)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  kind === k
                    ? k === 'INCOME'
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                      : 'border-rose-400 bg-rose-50 text-rose-800'
                    : 'border-navy-100 text-navy-600 hover:border-navy-300'
                }`}
              >
                {FINANCE_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Статья *</label>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as FinanceCategory)}
            >
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {FINANCE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Дата *</label>
            <DatePicker value={date} onChange={setDate} />
          </div>
        </div>

        <div>
          <label className="label">Сумма, сомони *</label>
          <MoneyInput value={amount} onChange={setAmount} />
        </div>

        <div>
          <label className="label">Название *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Закупка моющих средств"
          />
        </div>

        <div>
          <label className="label">Комментарий</label>
          <textarea
            className="input min-h-[64px]"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Необязательно"
          />
        </div>

        <div>
          <label className="label">Привязка к заказу</label>
          <OrderPicker value={order} onChange={setOrder} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button onClick={submit} disabled={!canSubmit} className="btn-primary">
            {initial ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Поиск заказа по клиенту/телефону для привязки финансовой операции */
function OrderPicker({
  value,
  onChange,
}: {
  value: OrderLink | null;
  onChange: (v: OrderLink | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Order[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api
        .get<Order[]>(`/orders?search=${encodeURIComponent(term)}`)
        .then((r) => setResults(r.data.slice(0, 8)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-navy-100 bg-navy-50/60 px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-navy-700">{value.label}</span>
        <button
          type="button"
          className="shrink-0 text-navy-600 hover:text-rose-600"
          onClick={() => onChange(null)}
          aria-label="Отвязать заказ"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-600" />
        <input
          className="input pl-9"
          placeholder="Поиск заказа по имени или телефону клиента (необязательно)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {query.trim() && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-navy-100 bg-white shadow-card">
          {searching && <div className="px-3 py-2 text-xs text-navy-600">Ищем…</div>}
          {!searching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-navy-600">Ничего не найдено</div>
          )}
          {results.map((o) => (
            <button
              key={o.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-navy-50"
              onClick={() => {
                onChange({
                  id: o.id,
                  clientId: o.clientId,
                  label: `${o.client?.fullName ?? 'Заказ'}${o.address ? ` · ${o.address}` : ''}`,
                });
                setQuery('');
                setResults([]);
              }}
            >
              <div className="font-medium text-navy-900">{o.client?.fullName ?? '—'}</div>
              <div className="text-xs text-navy-600">
                {o.client?.phone ?? ''}
                {o.address ? ` · ${o.address}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Вкладка «Премии» ───────────────────────────

interface BonusPayload {
  cleanerId?: string;
  userId?: string;
  amount: number;
  reason: string;
  periodFrom?: string;
  periodTo?: string;
}

function BonusesTab() {
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();

  const [period, setPeriod] = useState<Period>(() => rangeOf('month'));
  const [modalOpen, setModalOpen] = useState(false);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (period.from) q.set('from', period.from);
    if (period.to) q.set('to', period.to);
    return q.toString();
  }, [period.from, period.to]);

  const { data, loading, error, reload, setData } = useFetch<Bonus[]>(`/bonuses?${query}`, {
    deps: [query],
  });

  const rows = data ?? [];

  const refreshAfterMutation = () => {
    invalidate('/bonuses');
    invalidate('/finance');
    invalidate('/analytics');
    invalidate('/payroll'); // премии учитываются в выплатах (ТЗ 7.2)
  };

  const createBonus = async (payload: BonusPayload, recipientName: string) => {
    setModalOpen(false);
    const optimistic: Bonus = {
      id: tempId(),
      cleanerId: payload.cleanerId ?? null,
      userId: payload.userId ?? null,
      recipientName,
      amount: payload.amount,
      reason: payload.reason,
      periodFrom: payload.periodFrom ?? null,
      periodTo: payload.periodTo ?? null,
      createdByName: user?.fullName ?? '',
      paidAt: null,
      createdAt: nowISO(),
    };
    setData((list) => (list ? [optimistic, ...list] : [optimistic]));
    toast.success('Премия начислена. Расход добавлен в книгу доходов и расходов.');
    try {
      const res = await api.post<Bonus>('/bonuses', payload);
      setData((list) => (list ? list.map((b) => (b.id === optimistic.id ? res.data : b)) : list));
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось начислить премию');
      setData((list) => (list ? list.filter((b) => b.id !== optimistic.id) : list));
    } finally {
      refreshAfterMutation();
    }
  };

  const payBonus = async (bonus: Bonus) => {
    const before = bonus;
    setData((list) =>
      list ? list.map((b) => (b.id === bonus.id ? { ...b, paidAt: nowISO() } : b)) : list,
    );
    try {
      const res = await api.post<Bonus>(`/bonuses/${bonus.id}/pay`);
      setData((list) => (list ? list.map((b) => (b.id === bonus.id ? res.data : b)) : list));
      toast.success('Отмечено как выплаченное');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось отметить выплату');
      setData((list) => (list ? list.map((b) => (b.id === bonus.id ? before : b)) : list));
    } finally {
      refreshAfterMutation();
    }
  };

  const removeBonus = async (bonus: Bonus) => {
    const ok = await dialog.confirm({
      title: 'Удалить премию?',
      message: `Премия «${bonus.recipientName}» (${formatPrice(bonus.amount)}) и связанный с ней расход будут перенесены в корзину.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    setData((list) => (list ? list.filter((b) => b.id !== bonus.id) : list));
    toast.success('Премия перенесена в корзину');
    try {
      await withRetry(() => api.delete(`/bonuses/${bonus.id}`));
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить премию');
      reload();
    } finally {
      refreshAfterMutation();
    }
  };

  const columns: Column<Bonus>[] = [
    {
      key: 'date',
      title: 'Начислено',
      render: (b) => formatDateTz(b.createdAt),
    },
    {
      key: 'recipient',
      title: 'Кому',
      render: (b) => (
        <div>
          <div className="font-medium text-navy-900">{b.recipientName}</div>
          <div className="text-xs text-navy-600">{b.cleanerId ? 'Клинер' : 'Сотрудник CRM'}</div>
        </div>
      ),
    },
    {
      key: 'reason',
      title: 'За что',
      render: (b) => b.reason,
    },
    {
      key: 'period',
      title: 'Период',
      hideOnMobile: true,
      render: (b) =>
        b.periodFrom || b.periodTo
          ? `${formatDateTz(b.periodFrom)} – ${formatDateTz(b.periodTo)}`
          : '—',
    },
    {
      key: 'amount',
      title: 'Сумма',
      numeric: true,
      render: (b) => <span className="font-semibold text-rose-600">− {formatPrice(b.amount)}</span>,
    },
    {
      key: 'paid',
      title: 'Выплата',
      render: (b) =>
        b.paidAt ? (
          <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
            Выплачено {formatDateTz(b.paidAt)}
          </Badge>
        ) : (
          <button
            onClick={() => payBonus(b)}
            className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            Отметить выплату
          </button>
        ),
    },
    {
      key: 'actions',
      title: '',
      render: (b) => (
        <div className="flex justify-end">
          <button
            onClick={() => removeBonus(b)}
            className="rounded-lg p-1.5 text-navy-600 hover:bg-rose-50 hover:text-rose-600"
            title="Удалить"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Gift className="h-5 w-5" />
          </span>
          <div>
            <div className="font-bold text-navy-900">Выплаты и премии</div>
            <div className="text-xs text-navy-600">
              Начисление премии автоматически создаёт расход в книге доходов и расходов
            </div>
          </div>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" />
          Начислить премию
        </button>
      </div>

      <div className="mb-4">
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      <DataTable<Bonus>
        columns={columns}
        rows={rows}
        rowKey={(b) => b.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyText="За выбранный период премий не начислялось. Начислите премию клинеру или сотруднику кнопкой выше."
      />

      {modalOpen && (
        <BonusModal onClose={() => setModalOpen(false)} onSubmit={createBonus} />
      )}
    </div>
  );
}

function BonusModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: BonusPayload, recipientName: string) => void;
}) {
  const [recipientType, setRecipientType] = useState<'cleaner' | 'user'>('cleaner');
  const [cleanerId, setCleanerId] = useState('');
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');

  const { data: cleaners } = useFetch<Cleaner[]>('/cleaners?activeOnly=true');
  const { data: users } = useFetch<Manager[]>('/users/assignable');

  const recipientId = recipientType === 'cleaner' ? cleanerId : userId;
  const canSubmit = !!recipientId && amount > 0 && reason.trim().length >= 3;

  const submit = () => {
    if (!canSubmit) return;
    const recipient =
      recipientType === 'cleaner'
        ? (cleaners ?? []).find((c) => c.id === cleanerId)
        : (users ?? []).find((u) => u.id === userId);
    onSubmit(
      {
        cleanerId: recipientType === 'cleaner' ? cleanerId : undefined,
        userId: recipientType === 'user' ? userId : undefined,
        amount,
        reason: reason.trim(),
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
      },
      recipient?.fullName ?? '—',
    );
  };

  return (
    <Modal open onClose={onClose} title="Начислить премию">
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Начисление премии автоматически создаёт расход в книге доходов и расходов
          (статья «Премии») — отдельно вносить его не нужно.
        </p>

        <div>
          <label className="label">Кому *</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRecipientType('cleaner')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                recipientType === 'cleaner'
                  ? 'border-navy-500 bg-navy-50 text-navy-800'
                  : 'border-navy-100 text-navy-600 hover:border-navy-300'
              }`}
            >
              Клинер
            </button>
            <button
              type="button"
              onClick={() => setRecipientType('user')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                recipientType === 'user'
                  ? 'border-navy-500 bg-navy-50 text-navy-800'
                  : 'border-navy-100 text-navy-600 hover:border-navy-300'
              }`}
            >
              Сотрудник CRM
            </button>
          </div>
        </div>

        {recipientType === 'cleaner' ? (
          <select className="input" value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
            <option value="">— выберите клинера —</option>
            {(cleaners ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        ) : (
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— выберите сотрудника —</option>
            {(users ?? [])
              .filter((u) => u.isActive)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
          </select>
        )}

        <div>
          <label className="label">Сумма, сомони *</label>
          <MoneyInput value={amount} onChange={setAmount} />
        </div>

        <div>
          <label className="label">За что *</label>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: перевыполнение плана в июле"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Период с</label>
            <DatePicker
              compact
              placeholder="с даты"
              value={periodFrom}
              maxDate={periodTo || undefined}
              onChange={setPeriodFrom}
            />
          </div>
          <div>
            <label className="label">Период по</label>
            <DatePicker
              compact
              placeholder="по дату"
              value={periodTo}
              minDate={periodFrom || undefined}
              onChange={setPeriodTo}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button onClick={submit} disabled={!canSubmit} className="btn-primary">
            Начислить
          </button>
        </div>
      </div>
    </Modal>
  );
}
