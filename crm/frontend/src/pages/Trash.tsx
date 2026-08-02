import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { invalidate, useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/ui';
import {
  Column,
  DataTable,
  Period,
  FilterReset,
  PeriodFilter,
  SearchInput,
  Tabs,
} from '../components/common';
import { formatDateTimeTz, humanDeadline } from '../lib/date';
import { TRASH_FINANCIAL_TYPES, TRASH_TYPE_LABEL } from '../lib/labels';
import { userCanPurge, userIsOpsOnly } from '../types';
import type { TrashCounts, TrashItem, TrashType } from '../types';

/**
 * Порядок разделов корзины — совпадает с TRASH_TYPES в
 * crm/backend/src/trash/trash.registry.ts, чтобы вкладки шли в предсказуемом,
 * а не произвольном порядке ключей объекта.
 */
const ALL_TRASH_TYPES: TrashType[] = [
  'order',
  'client',
  'task',
  'cleaner',
  'user',
  'report',
  'financeEntry',
  'bonus',
  'tariff',
  'extraService',
  'proposal',
  'reminder',
  'shiftGroup',
];

type TabValue = 'all' | TrashType;

/**
 * Какие разделы затрагивает восстановление/удаление записи каждого типа —
 * чтобы после мутации сбросить именно те кэши, где эта запись видна,
 * а не гадать или чистить всё подряд.
 */
const AFFECTED_PREFIXES: Record<TrashType, string[]> = {
  order: ['/orders', '/analytics'],
  client: ['/clients', '/orders', '/analytics'],
  task: ['/tasks', '/calendar'],
  cleaner: ['/cleaners', '/brigades', '/payroll'],
  user: ['/users'],
  report: ['/reports', '/analytics'],
  financeEntry: ['/finance', '/analytics'],
  bonus: ['/bonuses', '/finance', '/payroll'],
  tariff: ['/tariffs'],
  extraService: ['/tariffs'],
  proposal: ['/proposals'],
  reminder: ['/reminders'],
  shiftGroup: ['/payroll'],
};

function rowKey(item: TrashItem): string {
  return `${item.type}:${item.id}`;
}

export function Trash() {
  const { user } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const canPurge = userCanPurge(user);

  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [search, setSearch] = useState('');
  // по умолчанию без фильтра — в корзине могут лежать записи любого возраста,
  // «сузить» до текущего месяца пользователь может сам через PeriodFilter
  const [period, setPeriod] = useState<Period>({ from: '', to: '' });
  // id записей (rowKey), для которых сейчас идёт запрос восстановления/удаления —
  // блокирует повторный клик и гонки двойного нажатия
  const [pending, setPending] = useState<Set<string>>(new Set());

  // финансовые разделы (ведомости, финансы, премии) видит только тот, у кого
  // есть доступ к финансам — остальным вкладки просто не показываем
  const visibleTypes = useMemo(
    () =>
      ALL_TRASH_TYPES.filter(
        (t) => !TRASH_FINANCIAL_TYPES.includes(t) || !userIsOpsOnly(user),
      ),
    [user],
  );

  // если выбранная вкладка вдруг стала недоступна (например, обновилась сессия
  // без прав на финансы) — откатываемся на общий вид, а не показываем пустоту
  useEffect(() => {
    if (activeTab !== 'all' && !visibleTypes.includes(activeTab)) {
      setActiveTab('all');
    }
  }, [activeTab, visibleTypes]);

  const counts = useFetch<TrashCounts>('/trash/counts');

  const query = new URLSearchParams();
  if (activeTab !== 'all') {
    query.set('type', activeTab);
    // без фильтра по типу бэкенд сам отдаёт по 20 из каждого раздела —
    // расширяем лимит только когда смотрим один конкретный раздел
    query.set('take', '200');
  }
  const term = search.trim();
  if (term) query.set('search', term);
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);

  const list = useFetch<{ rows: TrashItem[]; total: number }>(
    `/trash?${query.toString()}`,
    { deps: [activeTab, term, period.from, period.to] },
  );

  const reloadAll = () => {
    list.reload();
    counts.reload();
  };

  const setBusy = (key: string, busy: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const bumpCount = (type: TrashType, delta: number) => {
    counts.setData((prev) =>
      prev
        ? {
            ...prev,
            [type]: Math.max(0, (prev[type] ?? 0) + delta),
            total: Math.max(0, prev.total + delta),
          }
        : prev,
    );
  };

  /** Восстановление — оптимистично убираем строку, при ошибке (в т.ч. 409) откатываем */
  const handleRestore = async (item: TrashItem) => {
    const key = rowKey(item);
    if (pending.has(key)) return;
    setBusy(key, true);
    list.setData((prev) =>
      prev
        ? { rows: prev.rows.filter((r) => rowKey(r) !== key), total: Math.max(0, prev.total - 1) }
        : prev,
    );
    bumpCount(item.type, -1);
    try {
      await api.post(`/trash/${item.type}/${item.id}/restore`);
      toast.success(`«${item.title}» восстановлено`);
      invalidate('/trash');
      AFFECTED_PREFIXES[item.type].forEach(invalidate);
    } catch (e: any) {
      // откат — вернуть строку и счётчик на место
      list.setData((prev) =>
        prev ? { rows: [item, ...prev.rows], total: prev.total + 1 } : prev,
      );
      bumpCount(item.type, 1);
      // сервер отдаёт понятный текст и для 409 (телефон/логин/ключ заняты),
      // и для прочих ошибок — своего обобщённого текста не подставляем
      toast.error(e?.response?.data?.message || 'Не удалось восстановить запись');
    } finally {
      setBusy(key, false);
    }
  };

  /** Безвозвратное удаление одной записи — только директор, с явным предупреждением */
  const handlePurgeOne = async (item: TrashItem) => {
    const key = rowKey(item);
    if (pending.has(key)) return;
    const ok = await dialog.confirm({
      title: 'Удалить безвозвратно?',
      message: `«${item.title}» будет удалено безвозвратно. Восстановить запись после этого будет нельзя.`,
      confirmText: 'Удалить навсегда',
      danger: true,
    });
    if (!ok) return;

    setBusy(key, true);
    list.setData((prev) =>
      prev
        ? { rows: prev.rows.filter((r) => rowKey(r) !== key), total: Math.max(0, prev.total - 1) }
        : prev,
    );
    bumpCount(item.type, -1);
    try {
      await api.delete(`/trash/${item.type}/${item.id}`);
      toast.success(`«${item.title}» удалено безвозвратно`);
      invalidate('/trash');
      AFFECTED_PREFIXES[item.type].forEach(invalidate);
    } catch (e: any) {
      list.setData((prev) =>
        prev ? { rows: [item, ...prev.rows], total: prev.total + 1 } : prev,
      );
      bumpCount(item.type, 1);
      toast.error(e?.response?.data?.message || 'Не удалось удалить запись');
    } finally {
      setBusy(key, false);
    }
  };

  /** Массовая очистка текущей вкладки (или всей корзины на вкладке «Все») */
  const handlePurgeAll = async () => {
    const scopeLabel = activeTab === 'all' ? 'всей корзины' : `раздела «${TRASH_TYPE_LABEL[activeTab]}»`;
    const ok = await dialog.confirm({
      title: 'Очистить корзину?',
      message: `Все записи ${scopeLabel} будут удалены безвозвратно. Это действие нельзя отменить.`,
      confirmText: 'Очистить безвозвратно',
      danger: true,
    });
    if (!ok) return;

    const params = new URLSearchParams({ confirm: 'true' });
    if (activeTab !== 'all') params.set('type', activeTab);

    try {
      const res = await api.delete<{ deleted: Record<TrashType, number>; total: number }>(
        `/trash?${params.toString()}`,
      );
      toast.success(
        res.data.total > 0
          ? `Безвозвратно удалено записей: ${res.data.total}`
          : 'Очищать было нечего — корзина уже пуста',
      );
      invalidate('/trash');
      const types = activeTab === 'all' ? ALL_TRASH_TYPES : [activeTab];
      types.forEach((t) => AFFECTED_PREFIXES[t].forEach(invalidate));
      reloadAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось очистить корзину');
    }
  };

  const tabItems = [
    { value: 'all' as TabValue, label: 'Все', badge: counts.data?.total },
    ...visibleTypes.map((t) => ({
      value: t as TabValue,
      label: TRASH_TYPE_LABEL[t],
      badge: counts.data?.[t],
    })),
  ];

  const columns: Column<TrashItem>[] = [
    {
      key: 'title',
      title: 'Объект',
      render: (row) => (
        <div>
          <div className="font-medium text-navy-900">{row.title}</div>
          {row.subtitle && <div className="text-xs text-navy-600">{row.subtitle}</div>}
          {activeTab === 'all' && (
            <div className="mt-1 inline-block rounded-full bg-navy-50 px-2 py-0.5 text-[11px] text-navy-600">
              {TRASH_TYPE_LABEL[row.type]}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'deleted',
      title: 'Когда и кем удалено',
      render: (row) => (
        <div>
          <div>{formatDateTimeTz(row.deletedAt)}</div>
          <div className="text-xs text-navy-600">{row.deletedBy ?? 'неизвестно'}</div>
        </div>
      ),
    },
    {
      key: 'reason',
      title: 'Причина',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-navy-600">{row.deleteReason || '—'}</span>
      ),
    },
    {
      key: 'purgeAt',
      title: 'Автоочистка',
      render: (row) =>
        row.purgeAt ? (
          <span className="text-navy-600">{humanDeadline(row.purgeAt)}</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      title: 'Действия',
      render: (row) => {
        const busy = pending.has(rowKey(row));
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-50"
              disabled={busy}
              onClick={() => handleRestore(row)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Восстановить
            </button>
            {canPurge && (
              <button
                className="btn-danger px-2.5 py-1.5 text-xs disabled:opacity-50"
                disabled={busy}
                onClick={() => handlePurgeOne(row)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить навсегда
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const hasFilters = !!term || !!period.from || !!period.to;
  const emptyText =
    activeTab === 'all' && !hasFilters
      ? 'Корзина пуста. Удалённые заказы, клиенты и другие записи будут появляться здесь и храниться какое-то время, прежде чем очистятся автоматически.'
      : hasFilters
        ? 'По этому фильтру в корзине ничего не найдено — попробуйте изменить поиск или период.'
        : `В разделе «${activeTab !== 'all' ? TRASH_TYPE_LABEL[activeTab] : ''}» пока ничего нет.`;

  return (
    <div>
      <PageHeader
        title="Корзина"
        action={
          canPurge && (
            <button
              className="btn-danger"
              onClick={handlePurgeAll}
              disabled={!list.data?.rows.length}
            >
              <AlertTriangle className="h-4 w-4" />
              Очистить {activeTab === 'all' ? 'корзину' : 'раздел'}
            </button>
          )
        }
      />

      <div className="mb-4">
        <Tabs items={tabItems} value={activeTab} onChange={setActiveTab} />
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-[220px] flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по названию, адресу, телефону" />
        </div>
        <PeriodFilter value={period} onChange={setPeriod} presets={['today', 'week', 'month', 'quarter', 'year', 'all']} />
        <FilterReset show={!!search} onReset={() => setSearch('')} />
      </div>

      <DataTable
        columns={columns}
        rows={list.data?.rows}
        rowKey={rowKey}
        loading={list.loading}
        error={list.error}
        onRetry={reloadAll}
        emptyText={emptyText}
        perPage={20}
      />
    </div>
  );
}
