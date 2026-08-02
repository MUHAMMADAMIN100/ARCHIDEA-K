import { useMemo, useState } from 'react';
import { PhoneCall, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Badge } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { ReminderModal } from '../components/ReminderModal';
import { Column, DataTable, Period, PeriodFilter, Tabs, UserPicker } from '../components/common';
import { REMINDER_STATUS_COLOR, REMINDER_STATUS_LABEL } from '../lib/labels';
import { daysUntil, formatDateTimeTz, humanDeadline, rangeOf } from '../lib/date';
import { nowISO, withRetry } from '../lib/util';
import { userSeesAll } from '../types';
import type { Reminder } from '../types';

type TabKey = 'due' | 'planned' | 'done' | 'all';

/**
 * Напоминания перезвонить клиенту (ТЗ 10.1). Просроченный звонок — это
 * упущенный заказ, поэтому вкладка «Пора звонить» вынесена первой и
 * подсвечивается отдельно от остальных.
 */
export function Reminders() {
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const seesAll = userSeesAll(user);

  const [tab, setTab] = useState<TabKey>('due');
  // «Всё время» по умолчанию: просроченный звонок недельной давности не должен
  // прятаться только потому, что фильтр периода молча ограничил его месяцем.
  const [period, setPeriod] = useState<Period>(() => rangeOf('all'));
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reminder | null>(null);

  const query = new URLSearchParams();
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);
  if (seesAll && assigneeId) query.set('assigneeId', assigneeId);

  const { data, loading, error, reload, setData } = useFetch<Reminder[]>(
    `/reminders?${query.toString()}`,
    { deps: [period.from, period.to, assigneeId], pollMs: 30000 },
  );

  const { due, planned, done, all } = useMemo(() => {
    const list = data ?? [];
    return {
      due: list.filter((r) => r.status === 'PENDING' && (daysUntil(r.remindAt) ?? 1) <= 0),
      planned: list.filter((r) => r.status === 'PENDING' && (daysUntil(r.remindAt) ?? 1) > 0),
      done: list.filter((r) => r.status === 'DONE'),
      all: list,
    };
  }, [data]);

  const rowsByTab: Record<TabKey, Reminder[]> = { due, planned, done, all };
  const emptyTextByTab: Record<TabKey, string> = {
    due: 'Пора звонить некому — все просроченные и сегодняшние напоминания обработаны.',
    planned: 'Запланированных напоминаний нет. Поставьте их из карточки клиента или заказа.',
    done: 'Выполненных напоминаний за выбранный период нет.',
    all: 'Напоминаний пока нет. Ставьте их из карточки клиента, чтобы не забыть перезвонить.',
  };

  const patch = (id: string, changes: Partial<Reminder>) =>
    setData((list) => (list ? list.map((r) => (r.id === id ? { ...r, ...changes } : r)) : list));

  /** «Позвонил» — менеджер уже связался с клиентом */
  const markDone = async (r: Reminder) => {
    patch(r.id, { status: 'DONE', doneAt: nowISO() });
    try {
      await api.post(`/reminders/${r.id}/done`);
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось отметить напоминание выполненным');
      patch(r.id, { status: r.status, doneAt: r.doneAt });
    }
  };

  const cancelReminder = async (r: Reminder) => {
    const ok = await dialog.confirm({
      title: 'Отменить напоминание?',
      message: `«${r.title}» больше не будет напоминать о звонке.`,
      confirmText: 'Отменить напоминание',
    });
    if (!ok) return;
    patch(r.id, { status: 'CANCELLED' });
    try {
      await api.post(`/reminders/${r.id}/cancel`);
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось отменить напоминание');
      patch(r.id, { status: r.status });
    }
  };

  const removeReminder = async (r: Reminder) => {
    const ok = await dialog.confirm({
      title: 'Удалить напоминание?',
      message: 'Запись переместится в корзину — её можно будет восстановить.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setData((list) => (list ? list.filter((x) => x.id !== r.id) : list));
    try {
      await withRetry(() => api.delete(`/reminders/${r.id}`));
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить напоминание');
      reload();
    }
  };

  const columns: Column<Reminder>[] = [
    {
      key: 'when',
      title: 'Когда напомнить',
      render: (r) => {
        const overdue = r.status === 'PENDING' && (daysUntil(r.remindAt) ?? 0) < 0;
        return (
          <div>
            <div className={`font-medium ${overdue ? 'text-red-600' : 'text-navy-900'}`}>
              {formatDateTimeTz(r.remindAt)}
            </div>
            <div className={`text-xs ${overdue ? 'font-semibold text-red-500' : 'text-navy-600'}`}>
              {humanDeadline(r.remindAt)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'client',
      title: 'Клиент',
      render: (r) => (
        <div>
          <div className="font-medium text-navy-900">{r.client?.fullName ?? '—'}</div>
          {r.client?.phone && (
            <a href={`tel:${r.client.phone}`} className="text-xs text-brand-600 hover:underline">
              {r.client.phone}
            </a>
          )}
        </div>
      ),
    },
    {
      key: 'title',
      title: 'О чём напомнить',
      render: (r) => (
        <div className="max-w-xs">
          <div className="font-medium text-navy-900">{r.title}</div>
          {r.note && <div className="mt-0.5 text-xs text-navy-600">{r.note}</div>}
          {tab === 'all' && (
            <Badge className={`mt-1 ${REMINDER_STATUS_COLOR[r.status]}`}>
              {REMINDER_STATUS_LABEL[r.status]}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'assignee',
      title: 'Кому назначено',
      render: (r) => r.assigneeName,
    },
    {
      key: 'createdBy',
      title: 'Кто поставил',
      hideOnMobile: true,
      render: (r) => r.createdByName,
    },
    {
      key: 'actions',
      title: '',
      render: (r) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {r.status === 'PENDING' && (
            <button
              onClick={() => markDone(r)}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              Позвонил
            </button>
          )}
          {r.status === 'PENDING' && (
            <button
              onClick={() => cancelReminder(r)}
              className="rounded-lg border border-navy-200 px-2 py-1 text-xs text-navy-600 transition hover:bg-navy-50"
            >
              Отменить
            </button>
          )}
          {r.status !== 'CANCELLED' && (
            <button
              onClick={() => setEditing(r)}
              className="rounded-lg p-1.5 text-navy-600 transition hover:bg-navy-50 hover:text-navy-700"
              title="Изменить"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => removeReminder(r)}
            className="rounded-lg p-1.5 text-navy-600 transition hover:bg-red-50 hover:text-red-600"
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
      <PageHeader
        title="Напоминания"
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs<TabKey>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'due', label: 'Пора звонить', badge: due.length },
            { value: 'planned', label: 'Запланировано', badge: planned.length },
            { value: 'done', label: 'Выполнено' },
            { value: 'all', label: 'Все' },
          ]}
        />
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        {seesAll && (
          <div className="min-w-[200px]">
            <UserPicker value={assigneeId} onChange={setAssigneeId} placeholder="Все сотрудники" />
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rowsByTab[tab]}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyText={emptyTextByTab[tab]}
      />

      <ReminderModal
        open={!!editing}
        onClose={() => setEditing(null)}
        clientId={editing?.clientId}
        clientName={editing?.client?.fullName}
        orderId={editing?.orderId}
        reminder={editing ?? undefined}
        onSaved={(saved) => {
          patch(saved.id, saved);
          setEditing(null);
        }}
      />
    </div>
  );
}
