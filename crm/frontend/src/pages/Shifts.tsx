import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Wallet,
  AlertTriangle,
  Trash2,
  Plus,
  MapPin,
  Pencil,
  Lock,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { useFetch, invalidate } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Spinner, PageHeader, Modal, EmptyState, ErrorState, Badge } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { DatePicker } from '../components/DatePicker';
import { HistoryPanel } from '../components/HistoryPanel';
import {
  DrillValue,
  DetailModal,
  DetailStats,
  DetailTabs,
  DetailTable,
} from '../components/Drilldown';
import {
  CleanerPicker,
  UserPicker,
  Tabs,
  Period,
  PeriodFilter,
} from '../components/common';
import {
  formatPrice,
  formatDate,
  STAGE_LABEL,
  SHIFT_GROUP_STATUS_LABEL,
  SHIFT_GROUP_STATUS_COLOR,
} from '../lib/labels';
import { formatDateTz, formatDateTimeTz, monthRange, shiftMonth, todayISO } from '../lib/date';
import { tempId, withRetry } from '../lib/util';
import { userSeesAll,
  userIsOpsOnly,
} from '../types';
import type {
  Brigade,
  Cleaner,
  Fine,
  Manager,
  Order,
  PayrollRow,
  PayrollSummary,
  Shift,
  ShiftGroup,
  ShiftGroupStatus,
} from '../types';

type ShiftsTab = 'visits' | 'payroll' | 'fines';

export function Shifts() {
  const { user } = useAuth();
  const canManageVisits = userSeesAll(user);
  const [tab, setTab] = useState<ShiftsTab>('visits');

  /*
   * Выплаты и штрафы — деньги, и бэкенд закрывает их от ops-менеджера
   * (NoOpsFinanceGuard). Раньше вкладки показывались всем, и ops упирался
   * в 403 на уже открытой вкладке. Теперь их просто нет в списке.
   */
  const showMoney = !userIsOpsOnly(user);
  const tabs = [
    { value: 'visits' as const, label: 'Выезды' },
    ...(showMoney
      ? [
          { value: 'payroll' as const, label: 'Выплаты' },
          { value: 'fines' as const, label: 'Штрафы' },
        ]
      : []),
  ];

  // если вкладка стала недоступной (сменились права) — возвращаемся к выездам
  useEffect(() => {
    if (!tabs.some((t) => t.value === tab)) setTab('visits');
  }, [tab, showMoney]);

  return (
    <div>
      <PageHeader
        title="Смены и выезды"
        subtitle="Куда, когда и с кем выезжала команда — и что за это начислено"
      />

      <div className="mb-4">
        <Tabs items={tabs} value={tab} onChange={setTab} />
      </div>

      {tab === 'visits' && <ShiftGroupsSection canManage={canManageVisits} />}
      {tab === 'payroll' && showMoney && <PayrollSummarySection />}
      {tab === 'fines' && showMoney && <FinesSection />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Вкладка «Выезды» (ТЗ 4)
// ═══════════════════════════════════════════════════════════

function ShiftGroupsSection({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const dialog = useDialog();
  const [period, setPeriod] = useState<Period>(() => monthRange());
  const [status, setStatus] = useState<ShiftGroupStatus | ''>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShiftGroup | null>(null);
  const [historyFor, setHistoryFor] = useState<ShiftGroup | null>(null);

  const query = new URLSearchParams();
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);
  if (status) query.set('status', status);
  if (search.trim()) query.set('search', search.trim());

  const { data, loading, error, reload, setData } = useFetch<ShiftGroup[]>(
    `/shift-groups?${query.toString()}`,
    { deps: [period.from, period.to, status, search] },
  );

  // справочники — для подписей в оптимистичных обновлениях и для форм
  const { data: brigades } = useFetch<Brigade[]>('/brigades');
  const { data: cleaners } = useFetch<Cleaner[]>('/cleaners?activeOnly=true');
  const { data: managers } = useFetch<Manager[]>('/users/assignable');

  const nameOf = {
    brigade: (id: string | null) => (brigades ?? []).find((b) => b.id === id)?.name ?? null,
    cleaner: (id: string | null) => (cleaners ?? []).find((c) => c.id === id)?.fullName ?? null,
    manager: (id: string | null) => (managers ?? []).find((m) => m.id === id)?.fullName ?? null,
  };

  const submitCreate = (payload: CreatePayload) => {
    const id = tempId();
    const members = payload.cleanerIds.map((cid) => ({
      id: tempId(),
      cleanerId: cid,
      fullName: nameOf.cleaner(cid) ?? '…',
      role: cid === payload.brigadierId ? 'Бригадир' : 'Клинер',
    }));
    const optimistic: ShiftGroup = {
      id,
      date: payload.date,
      address: payload.address,
      startTime: payload.startTime || null,
      endTime: payload.endTime || null,
      status: 'PLANNED',
      brigadeName: nameOf.brigade(payload.brigadeId),
      brigadierName: nameOf.cleaner(payload.brigadierId),
      managerName: nameOf.manager(payload.managerId) ?? null,
      members,
      note: payload.note || null,
    };
    setData((list) => (list ? [optimistic, ...list] : [optimistic]));
    setCreating(false);
    toast.success('Выезд запланирован');
    api
      .post('/shift-groups', {
        date: payload.date,
        address: payload.address,
        orderId: payload.orderId || undefined,
        startTime: payload.startTime || undefined,
        endTime: payload.endTime || undefined,
        brigadeId: payload.brigadeId || undefined,
        brigadierId: payload.brigadierId || undefined,
        managerId: payload.managerId || undefined,
        note: payload.note || undefined,
        cleanerIds: payload.cleanerIds,
      })
      .then(() => reload())
      .catch((e: any) => {
        toast.error(e?.response?.data?.message || 'Не удалось создать выезд');
        setData((list) => (list ? list.filter((g) => g.id !== id) : list));
      });
  };

  const submitUpdate = (group: ShiftGroup, payload: CreatePayload) => {
    const members = payload.cleanerIds.map((cid) => {
      const existing = group.members.find((m) => m.cleanerId === cid);
      return (
        existing ?? {
          id: tempId(),
          cleanerId: cid,
          fullName: nameOf.cleaner(cid) ?? '…',
          role: cid === payload.brigadierId ? 'Бригадир' : 'Клинер',
        }
      );
    });
    setData((list) =>
      list
        ? list.map((g) =>
            g.id === group.id
              ? {
                  ...g,
                  date: payload.date,
                  address: payload.address,
                  startTime: payload.startTime || null,
                  endTime: payload.endTime || null,
                  brigadeName: nameOf.brigade(payload.brigadeId),
                  brigadierName: nameOf.cleaner(payload.brigadierId),
                  managerName: nameOf.manager(payload.managerId) ?? null,
                  note: payload.note || null,
                  members,
                }
              : g,
          )
        : list,
    );
    setEditing(null);
    toast.success('Выезд обновлён');
    api
      .patch(`/shift-groups/${group.id}`, {
        date: payload.date,
        address: payload.address,
        orderId: payload.orderId || null,
        startTime: payload.startTime || undefined,
        endTime: payload.endTime || undefined,
        brigadeId: payload.brigadeId || null,
        brigadierId: payload.brigadierId || null,
        managerId: payload.managerId || null,
        note: payload.note ?? '',
        cleanerIds: payload.cleanerIds,
      })
      .then(() => reload())
      .catch((e: any) => {
        toast.error(e?.response?.data?.message || 'Не удалось сохранить изменения');
        reload();
      });
  };

  const closeGroup = async (group: ShiftGroup) => {
    const ok = await dialog.confirm({
      title: 'Закрыть смену?',
      message:
        'После закрытия адрес, время и состав выезда будут заархивированы и правке не подлежат. Каждому участнику будет начислена оплачиваемая смена за этот день.',
      confirmText: 'Закрыть смену',
    });
    if (!ok) return;

    setData((list) =>
      list ? list.map((g) => (g.id === group.id ? { ...g, status: 'CLOSED' } : g)) : list,
    );
    withRetry(() => api.post(`/shift-groups/${group.id}/close`, {}))
      .then(() => {
        toast.success('Смена закрыта, выплаты начислены');
        invalidate('/payroll');
        invalidate('/shift-groups');
        reload();
      })
      .catch((e: any) => {
        toast.error(e?.response?.data?.message || 'Не удалось закрыть смену');
        reload();
      });
  };

  const removeGroup = async (group: ShiftGroup) => {
    const ok = await dialog.confirm({
      title: 'Удалить выезд?',
      message: `Выезд «${group.address}» (${formatDateTz(group.date)}) будет перемещён в корзину. Восстановить его можно в разделе «Корзина» в течение 90 дней.`,
      confirmText: 'В корзину',
      danger: true,
    });
    if (!ok) return;

    setData((list) => (list ? list.filter((g) => g.id !== group.id) : list));
    toast.success('Выезд перемещён в корзину');
    withRetry(() => api.delete(`/shift-groups/${group.id}`)).catch((e: any) => {
      toast.error(e?.response?.data?.message || 'Не удалось удалить выезд');
      reload();
    });
  };

  return (
    <div>
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <PeriodFilter value={period} onChange={setPeriod} showMonthArrows />
        <select
          className="input max-w-[180px]"
          value={status}
          onChange={(e) => setStatus(e.target.value as ShiftGroupStatus | '')}
        >
          <option value="">Все статусы</option>
          <option value="PLANNED">{SHIFT_GROUP_STATUS_LABEL.PLANNED}</option>
          <option value="IN_PROGRESS">{SHIFT_GROUP_STATUS_LABEL.IN_PROGRESS}</option>
          <option value="CLOSED">{SHIFT_GROUP_STATUS_LABEL.CLOSED}</option>
        </select>
        <input
          className="input max-w-[220px]"
          placeholder="Поиск: адрес, бригада, ФИО"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canManage && (
          <button onClick={() => setCreating(true)} className="btn-primary ml-auto">
            <Plus className="h-4 w-4" />
            Новый выезд
          </button>
        )}
      </div>

      {error ? (
        <ErrorState onRetry={reload} />
      ) : loading && !data ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <EmptyState text="За выбранный период выездов нет. Запланируйте выезд, чтобы зафиксировать адрес и состав бригады." />
      ) : (
        <div className="space-y-3">
          {data.map((g) => (
            <ShiftGroupCard
              key={g.id}
              group={g}
              canManage={canManage}
              onEdit={() => setEditing(g)}
              onClose={() => closeGroup(g)}
              onDelete={() => removeGroup(g)}
              onHistory={() => setHistoryFor(g)}
            />
          ))}
        </div>
      )}

      {creating && (
        <ShiftGroupModal title="Новый выезд" onClose={() => setCreating(false)} onSubmit={submitCreate} />
      )}
      {editing && (
        <ShiftGroupModal
          title="Правка выезда"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={(payload) => submitUpdate(editing, payload)}
        />
      )}
      {historyFor && (
        <Modal open onClose={() => setHistoryFor(null)} title={`История: ${historyFor.address}`} wide>
          <HistoryPanel entity="SHIFT_GROUP" entityId={historyFor.id} />
        </Modal>
      )}
    </div>
  );
}

function ShiftGroupCard({
  group,
  canManage,
  onEdit,
  onClose,
  onDelete,
  onHistory,
}: {
  group: ShiftGroup;
  canManage: boolean;
  onEdit: () => void;
  onClose: () => void;
  onDelete: () => void;
  onHistory: () => void;
}) {
  const closed = group.status === 'CLOSED';
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-navy-900">{formatDateTz(group.date)}</span>
            <Badge className={SHIFT_GROUP_STATUS_COLOR[group.status]}>
              {SHIFT_GROUP_STATUS_LABEL[group.status]}
            </Badge>
            {(group.startTime || group.endTime) && (
              <span className="text-xs text-navy-400">
                {group.startTime ?? '—'}–{group.endTime ?? '—'}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-navy-800">
            <MapPin className="h-4 w-4 shrink-0 text-navy-300" />
            {group.address}
          </div>
          {group.order?.client && (
            <div className="mt-1 text-xs text-navy-400">
              Заказ: {group.order.client.fullName}
              {group.order.address ? ` · ${group.order.address}` : ''}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            onClick={onHistory}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-navy-400 hover:bg-navy-50 hover:text-navy-700"
          >
            История
          </button>
          {canManage && !closed && (
            <>
              <button onClick={onEdit} className="btn-ghost px-2.5 py-1.5 text-xs">
                <Pencil className="h-3.5 w-3.5" />
                Изменить
              </button>
              <button
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
              >
                <Lock className="h-3.5 w-3.5" />
                Закрыть смену
              </button>
              <button
                onClick={onDelete}
                className="rounded-lg p-1.5 text-navy-300 hover:bg-red-50 hover:text-red-600"
                title="В корзину"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-navy-400">Бригада</div>
          <div className="text-sm text-navy-700">
            {group.brigadeName ?? '—'}
            {group.brigadierName ? ` · бригадир ${group.brigadierName}` : ''}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-navy-400">
            Ответственный менеджер
          </div>
          <div className="text-sm text-navy-700">{group.managerName ?? '—'}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-navy-400">Состав</div>
        {group.members.length === 0 ? (
          <div className="mt-1 text-sm text-navy-400">Состав не назначен</div>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {group.members.map((m) => (
              <span
                key={m.id}
                className="rounded-lg border border-navy-100 bg-navy-50/60 px-2 py-1 text-xs text-navy-700"
              >
                {m.fullName}
                {m.role === 'Бригадир' ? ' · бригадир' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {group.note && <p className="mt-3 text-sm text-navy-500">{group.note}</p>}

      {closed && (
        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-xs text-emerald-800">
          <div className="font-semibold">Смена закрыта — данные заархивированы</div>
          <div className="mt-0.5 text-emerald-700">
            {group.closedByName ? `Закрыл(а): ${group.closedByName}` : 'Кто закрыл — не определено'}
            {group.closedAt ? ` · ${formatDateTimeTz(group.closedAt)}` : ''}
          </div>
          {group.closedSnapshot && (
            <div className="mt-1 text-emerald-700">
              Архивный слепок состава: {group.closedSnapshot.members.map((m) => m.fullName).join(', ') || '—'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CreatePayload {
  date: string;
  address: string;
  orderId: string;
  startTime: string;
  endTime: string;
  brigadeId: string;
  brigadierId: string;
  managerId: string;
  note: string;
  cleanerIds: string[];
}

function ShiftGroupModal({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: ShiftGroup;
  onClose: () => void;
  onSubmit: (payload: CreatePayload) => void;
}) {
  const { data: brigades } = useFetch<Brigade[]>('/brigades');
  const { data: cleaners } = useFetch<Cleaner[]>('/cleaners?activeOnly=true');

  const [date, setDate] = useState(initial?.date ? initial.date.slice(0, 10) : todayISO());
  const [address, setAddress] = useState(initial?.address ?? '');
  const [order, setOrder] = useState<OrderPickerValue | null>(initial?.order ?? null);
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  const [brigadeId, setBrigadeId] = useState(initial?.brigadeId ?? '');
  const [brigadierId, setBrigadierId] = useState(initial?.brigadierId ?? '');
  const [managerId, setManagerId] = useState<string | null>(initial?.managerId ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [cleanerIds, setCleanerIds] = useState<string[]>(
    initial?.members.map((m) => m.cleanerId) ?? [],
  );

  const brigadeCleaners = brigadeId
    ? (brigades ?? []).find((b) => b.id === brigadeId)?.cleaners ?? []
    : cleaners ?? [];

  const canSubmit = address.trim().length >= 3 && date;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      date,
      address: address.trim(),
      orderId: order?.id ?? '',
      startTime,
      endTime,
      brigadeId,
      brigadierId,
      managerId: managerId ?? '',
      note,
      cleanerIds,
    });
  };

  return (
    <Modal open onClose={onClose} title={title} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Дата выезда *</label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Начало</label>
              <input
                type="time"
                className="input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Окончание</label>
              <input
                type="time"
                className="input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Адрес объекта *</label>
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Улица, дом, ориентир"
          />
        </div>

        <OrderPicker
          order={order}
          onChange={(o) => {
            setOrder(o);
            if (o?.address && !address.trim()) setAddress(o.address);
          }}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Бригада</label>
            <select
              className="input"
              value={brigadeId}
              onChange={(e) => {
                setBrigadeId(e.target.value);
                setBrigadierId('');
              }}
            >
              <option value="">Без бригады</option>
              {(brigades ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Бригадир на выезде</label>
            <select className="input" value={brigadierId} onChange={(e) => setBrigadierId(e.target.value)}>
              <option value="">Не назначен</option>
              {brigadeCleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Ответственный менеджер</label>
          <UserPicker value={managerId} onChange={setManagerId} placeholder="Не назначен" />
        </div>

        <div>
          <label className="label">Состав — кто поехал</label>
          <CleanerPicker value={cleanerIds} onChange={setCleanerIds} />
        </div>

        <div>
          <label className="label">Примечание</label>
          <textarea
            className="input min-h-[70px] resize-none"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Что важно знать об этом выезде"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button onClick={submit} disabled={!canSubmit} className="btn-primary">
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Минимум полей заказа, нужный выезду: и полноценный `Order` из поиска,
 * и уже сохранённая ссылка `ShiftGroup.order` (без stage) сюда подходят.
 */
interface OrderPickerValue {
  id: string;
  address?: string | null;
  stage?: Order['stage'];
  client?: { id: string; fullName: string; phone: string } | null;
}

/** Поиск и привязка заказа к выезду (необязательно) */
function OrderPicker({
  order,
  onChange,
}: {
  order: OrderPickerValue | null;
  onChange: (o: Order | null) => void;
}) {
  const [query, setQuery] = useState('');
  const { data, loading, error } = useFetch<Order[]>(query.trim() ? '/orders' : null);

  const filtered = query.trim()
    ? (data ?? [])
        .filter((o) => {
          const q = query.trim().toLowerCase();
          return (
            o.client?.fullName?.toLowerCase().includes(q) ||
            o.address?.toLowerCase().includes(q)
          );
        })
        .slice(0, 8)
    : [];

  return (
    <div>
      <label className="label">Заказ (по желанию)</label>
      {order ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-navy-100 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            {order.client?.fullName ?? 'Без клиента'}
            {order.address ? ` · ${order.address}` : ''}
            {order.stage ? ` · ${STAGE_LABEL[order.stage]}` : ''}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-navy-400 hover:text-red-600"
            aria-label="Убрать привязку к заказу"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            className="input"
            placeholder="Начните вводить имя клиента или адрес"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() && (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-navy-100 bg-white shadow-card">
              {error ? (
                <div className="p-3 text-sm text-navy-400">Не удалось загрузить заказы</div>
              ) : loading && !data ? (
                <div className="p-3 text-sm text-navy-400">Загрузка…</div>
              ) : filtered.length === 0 ? (
                <div className="p-3 text-sm text-navy-400">Ничего не найдено</div>
              ) : (
                filtered.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => {
                      onChange(o);
                      setQuery('');
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-navy-50"
                  >
                    <div className="font-medium text-navy-900">
                      {o.client?.fullName ?? 'Без клиента'}
                    </div>
                    <div className="text-xs text-navy-400">
                      {o.address || 'без адреса'} · {STAGE_LABEL[o.stage]}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Вкладка «Выплаты» — сводка за месяц (без штрафов — у них своя вкладка)
// ═══════════════════════════════════════════════════════════

function PayrollSummarySection() {
  const toast = useToast();
  const [monthAnchor, setMonthAnchor] = useState(() => todayISO());
  const { from, to } = useMemo(() => monthRange(monthAnchor), [monthAnchor]);
  const label = useMemo(
    () =>
      new Date(`${monthAnchor.slice(0, 7)}-01T00:00:00`).toLocaleDateString('ru-RU', {
        month: 'long',
        year: 'numeric',
      }),
    [monthAnchor],
  );

  const { data: payroll, loading, reload } = useFetch<PayrollSummary>(
    `/payroll?from=${from}&to=${to}`,
    { deps: [from, to] },
  );
  const { data: cleaners } = useFetch<Cleaner[]>('/cleaners');

  const [fineFor, setFineFor] = useState<string | null>(null);
  // расшифровка: по какой строке и с какого раздела открыта модалка
  const [drillRow, setDrillRow] = useState<{ row: PayrollRow; tab: PayrollDetailTab } | null>(
    null,
  );
  // расшифровка сводных цифр: «Итого», бригада целиком, список без смен
  const [drillGroup, setDrillGroup] = useState<{
    title: string;
    subtitle: string;
    rows: PayrollRow[];
  } | null>(null);

  const quickFine = (payload: { cleanerId: string; amount: number; reason: string; date: string }) => {
    toast.success('Штраф назначен');
    api
      .post('/payroll/fines', payload)
      .then(() => reload())
      .catch((e: any) => {
        toast.error(e?.response?.data?.message || 'Не удалось назначить штраф');
      });
  };

  const shiftMonthAnchor = (delta: number) => setMonthAnchor((m) => shiftMonth(m, delta));

  const rows = (payroll?.rows ?? []).filter((r) => r.shifts > 0 || r.fines > 0);
  const idle = (payroll?.rows ?? []).filter((r) => r.shifts === 0 && r.fines === 0);

  // расшифровка строки «Итого» — та же ведомость, но целиком
  const totalsDrill = {
    title: 'Ведомость за период',
    subtitle: `Из чего сложилось «Итого» · ${label}`,
    rows,
  };

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100 text-green-700">
            <Wallet className="h-5 w-5" />
          </span>
          <div>
            <div className="font-bold text-navy-900">Выплаты за период</div>
            <div className="text-xs text-navy-400">
              Смены × ставка − штрафы = к выплате
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftMonthAnchor(-1)}
            className="rounded-lg p-2 text-navy-500 hover:bg-navy-50"
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] text-center text-sm font-bold capitalize text-navy-900">
            {label}
          </span>
          <button
            onClick={() => shiftMonthAnchor(1)}
            className="rounded-lg p-2 text-navy-500 hover:bg-navy-50"
            aria-label="Следующий месяц"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading && !payroll ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState text="В этом месяце смен ещё не отмечено" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-400">
                <th className="py-2.5 pr-3 font-semibold">Клинер</th>
                <th className="py-2.5 pr-3 font-semibold">Бригада</th>
                <th className="py-2.5 pr-3 text-right font-semibold">Смены</th>
                <th className="py-2.5 pr-3 text-right font-semibold">Начислено</th>
                <th className="py-2.5 pr-3 text-right font-semibold">Штрафы</th>
                <th className="py-2.5 pr-3 text-right font-semibold">К выплате</th>
                <th className="py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cleanerId} className="border-b border-navy-50">
                  <td className="py-2.5 pr-3 font-medium text-navy-900">
                    <DrillValue
                      tone="strong"
                      title={`Все смены и штрафы: ${r.fullName}`}
                      onClick={() => setDrillRow({ row: r, tab: 'shifts' })}
                    >
                      {r.fullName}
                    </DrillValue>
                  </td>
                  <td className="py-2.5 pr-3 text-navy-500">
                    {r.brigade ? (
                      <DrillValue
                        tone="muted"
                        title={`Вся бригада: ${r.brigade}`}
                        onClick={() =>
                          setDrillGroup({
                            title: r.brigade!,
                            subtitle: `Выплаты бригады · ${label}`,
                            rows: (payroll?.rows ?? []).filter(
                              (x) => x.brigadeId === r.brigadeId,
                            ),
                          })
                        }
                      >
                        {r.brigade}
                      </DrillValue>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-navy-800">
                    <DrillValue
                      align="right"
                      disabled={r.shifts === 0}
                      title={`Какие именно смены: ${r.fullName}`}
                      onClick={() => setDrillRow({ row: r, tab: 'shifts' })}
                    >
                      {r.shifts}
                    </DrillValue>
                  </td>
                  <td className="py-2.5 pr-3 text-right text-navy-800">
                    <DrillValue
                      align="right"
                      disabled={r.shifts === 0}
                      title="Из чего сложилось начисление"
                      onClick={() => setDrillRow({ row: r, tab: 'shifts' })}
                    >
                      {formatPrice(r.accrued)}
                    </DrillValue>
                  </td>
                  <td
                    className={`py-2.5 pr-3 text-right ${
                      r.fines > 0 ? '' : 'text-navy-300'
                    }`}
                  >
                    <DrillValue
                      align="right"
                      tone="danger"
                      disabled={r.fines === 0}
                      title="За что назначены штрафы"
                      onClick={() => setDrillRow({ row: r, tab: 'fines' })}
                    >
                      {r.fines > 0 ? `− ${formatPrice(r.fines)}` : '—'}
                    </DrillValue>
                  </td>
                  <td
                    className={`py-2.5 pr-3 text-right font-bold ${
                      r.total < 0 ? 'text-red-600' : 'text-navy-900'
                    }`}
                    title={r.total < 0 ? 'Штрафы превысили начисления (долг)' : undefined}
                  >
                    <DrillValue
                      align="right"
                      tone={r.total < 0 ? 'danger' : 'strong'}
                      title="Полный расчёт по клинеру"
                      onClick={() => setDrillRow({ row: r, tab: 'shifts' })}
                    >
                      {formatPrice(r.total)}
                    </DrillValue>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => setFineFor(r.cleanerId)}
                      className="rounded-lg p-1.5 text-navy-300 hover:bg-red-50 hover:text-red-600"
                      title="Оштрафовать"
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {payroll && (
              <tfoot>
                <tr className="text-sm font-bold text-navy-900">
                  <td className="py-3 pr-3">Итого</td>
                  <td />
                  <td className="py-3 pr-3 text-right">
                    <DrillValue
                      align="right"
                      tone="strong"
                      disabled={rows.length === 0}
                      title="Кто из чего сложил эти смены"
                      onClick={() => setDrillGroup(totalsDrill)}
                    >
                      {payroll.totals.shifts}
                    </DrillValue>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <DrillValue
                      align="right"
                      tone="strong"
                      disabled={rows.length === 0}
                      title="Разбивка начислений по клинерам"
                      onClick={() => setDrillGroup(totalsDrill)}
                    >
                      {formatPrice(payroll.totals.accrued)}
                    </DrillValue>
                  </td>
                  <td className="py-3 pr-3 text-right text-red-600">
                    <DrillValue
                      align="right"
                      tone="danger"
                      disabled={payroll.totals.fines === 0}
                      title="Все штрафы за период"
                      onClick={() =>
                        setDrillGroup({
                          title: 'Штрафы за период',
                          subtitle: `Кому и сколько · ${label}`,
                          rows: (payroll?.rows ?? []).filter((x) => x.fines > 0),
                        })
                      }
                    >
                      {payroll.totals.fines > 0
                        ? `− ${formatPrice(payroll.totals.fines)}`
                        : '—'}
                    </DrillValue>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <DrillValue
                      align="right"
                      tone={payroll.totals.total < 0 ? 'danger' : 'success'}
                      disabled={rows.length === 0}
                      title="Полная ведомость за период"
                      onClick={() => setDrillGroup(totalsDrill)}
                    >
                      {formatPrice(payroll.totals.total)}
                    </DrillValue>
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          {idle.length > 0 && (
            <p className="mt-2 text-xs text-navy-400">
              Без смен в этом месяце:{' '}
              <DrillValue
                tone="muted"
                title="Кто не выходил и какая у него ставка"
                onClick={() =>
                  setDrillGroup({
                    title: 'Без смен в этом месяце',
                    subtitle: `${idle.length} чел. · ${label}`,
                    rows: idle,
                  })
                }
                className="text-xs"
              >
                {idle.map((r) => r.fullName).join(', ')}
              </DrillValue>
            </p>
          )}
        </div>
      )}

      {fineFor !== null && (
        <FineModal
          cleaners={cleaners ?? []}
          initialCleanerId={fineFor}
          defaultDate={todayISO() >= from && todayISO() <= to ? todayISO() : from}
          onClose={() => setFineFor(null)}
          onSubmit={quickFine}
        />
      )}

      {drillRow && (
        <CleanerPayrollModal
          row={drillRow.row}
          initialTab={drillRow.tab}
          from={from}
          to={to}
          periodLabel={label}
          onClose={() => setDrillRow(null)}
        />
      )}

      {drillGroup && (
        <PayrollBreakdownModal
          title={drillGroup.title}
          subtitle={drillGroup.subtitle}
          rows={drillGroup.rows}
          onPick={(row) => {
            setDrillGroup(null);
            setDrillRow({ row, tab: row.shifts > 0 ? 'shifts' : 'fines' });
          }}
          onClose={() => setDrillGroup(null)}
        />
      )}
    </div>
  );
}

// ───────────── Расшифровка выплат ─────────────

type PayrollDetailTab = 'shifts' | 'fines';

/**
 * Что стоит за строкой клинера: конкретные смены (с датами и адресами выездов)
 * и конкретные штрафы (с причинами). Раньше в таблице было только «3» — теперь
 * видно, какие именно три дня и откуда взялась каждая ставка.
 */
function CleanerPayrollModal({
  row,
  initialTab,
  from,
  to,
  periodLabel,
  onClose,
}: {
  row: PayrollRow;
  initialTab: PayrollDetailTab;
  from: string;
  to: string;
  periodLabel: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PayrollDetailTab>(initialTab);

  const { data: shifts, loading: shiftsLoading } = useFetch<Shift[]>(
    `/payroll/shifts?from=${from}&to=${to}&cleanerId=${row.cleanerId}`,
    { deps: [row.cleanerId, from, to] },
  );
  const { data: fines, loading: finesLoading } = useFetch<Fine[]>(
    `/payroll/fines?from=${from}&to=${to}&cleanerId=${row.cleanerId}`,
    { deps: [row.cleanerId, from, to] },
  );

  return (
    <DetailModal
      title={row.fullName}
      subtitle={`${row.brigade ?? 'Без бригады'} · ставка ${formatPrice(row.rate)} · ${periodLabel}`}
      onClose={onClose}
    >
      <DetailStats
        items={[
          { label: 'Смены', value: row.shifts },
          { label: 'Начислено', value: formatPrice(row.accrued) },
          {
            label: 'Штрафы',
            value: row.fines > 0 ? `− ${formatPrice(row.fines)}` : '—',
            tone: row.fines > 0 ? 'danger' : 'default',
          },
          {
            label: 'К выплате',
            value: formatPrice(row.total),
            tone: row.total < 0 ? 'danger' : 'success',
          },
        ]}
      />

      <DetailTabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'shifts' as const, label: `Смены · ${row.shifts}` },
          { value: 'fines' as const, label: `Штрафы · ${fines?.length ?? 0}` },
        ]}
      />

      {tab === 'shifts' ? (
        <DetailTable
          rows={shifts}
          loading={shiftsLoading}
          rowKey={(s) => s.id}
          emptyText="В этом периоде смен не было"
          columns={[
            {
              key: 'date',
              header: 'Дата',
              cell: (s) => (
                <span className="font-medium text-navy-900">{formatDateTz(s.date)}</span>
              ),
            },
            {
              key: 'source',
              header: 'Откуда',
              cell: (s) =>
                s.group ? (
                  <div>
                    <div className="text-navy-800">{s.group.address}</div>
                    <div className="text-xs text-navy-400">
                      Выезд
                      {s.group.startTime ? ` · ${s.group.startTime}` : ''}
                      {s.group.endTime ? `–${s.group.endTime}` : ''}
                      {s.group.brigadeName ? ` · ${s.group.brigadeName}` : ''}
                    </div>
                  </div>
                ) : (
                  <span className="text-navy-400">Отметка дня{s.note ? ` · ${s.note}` : ''}</span>
                ),
            },
            {
              key: 'rate',
              header: 'Ставка',
              align: 'right',
              cell: (s) => formatPrice(s.rate),
            },
          ]}
          footer={
            shifts && shifts.length > 0 ? (
              <tr className="border-t border-navy-100 font-bold text-navy-900">
                <td className="px-3 py-2" colSpan={2}>
                  Начислено за {shifts.length}{' '}
                  {shifts.length === 1 ? 'смену' : shifts.length < 5 ? 'смены' : 'смен'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatPrice(shifts.reduce((sum, s) => sum + s.rate, 0))}
                </td>
              </tr>
            ) : undefined
          }
        />
      ) : (
        <DetailTable
          rows={fines}
          loading={finesLoading}
          rowKey={(f) => f.id}
          emptyText="Штрафов в этом периоде нет"
          columns={[
            {
              key: 'date',
              header: 'Дата',
              cell: (f) => (
                <span className="font-medium text-navy-900">{formatDateTz(f.date)}</span>
              ),
            },
            { key: 'reason', header: 'Причина', cell: (f) => f.reason },
            {
              key: 'amount',
              header: 'Сумма',
              align: 'right',
              cell: (f) => (
                <span className="font-medium text-red-600">− {formatPrice(f.amount)}</span>
              ),
            },
          ]}
          footer={
            fines && fines.length > 0 ? (
              <tr className="border-t border-navy-100 font-bold text-navy-900">
                <td className="px-3 py-2" colSpan={2}>
                  Всего удержано
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-red-600">
                  − {formatPrice(fines.reduce((sum, f) => sum + f.amount, 0))}
                </td>
              </tr>
            ) : undefined
          }
        />
      )}
    </DetailModal>
  );
}

/**
 * Расшифровка сводной цифры — «Итого», бригады целиком или списка без смен.
 * Строка внутри тоже кликабельна: с уровня бригады можно провалиться к клинеру.
 */
function PayrollBreakdownModal({
  title,
  subtitle,
  rows,
  onPick,
  onClose,
}: {
  title: string;
  subtitle: string;
  rows: PayrollRow[];
  onPick: (row: PayrollRow) => void;
  onClose: () => void;
}) {
  const totals = rows.reduce(
    (acc, r) => ({
      shifts: acc.shifts + r.shifts,
      accrued: acc.accrued + r.accrued,
      fines: acc.fines + r.fines,
      total: acc.total + r.total,
    }),
    { shifts: 0, accrued: 0, fines: 0, total: 0 },
  );

  return (
    <DetailModal title={title} subtitle={subtitle} onClose={onClose}>
      <DetailStats
        items={[
          { label: 'Человек', value: rows.length },
          { label: 'Смены', value: totals.shifts },
          {
            label: 'Штрафы',
            value: totals.fines > 0 ? `− ${formatPrice(totals.fines)}` : '—',
            tone: totals.fines > 0 ? 'danger' : 'default',
          },
          {
            label: 'К выплате',
            value: formatPrice(totals.total),
            tone: totals.total < 0 ? 'danger' : 'success',
          },
        ]}
      />

      <DetailTable
        rows={rows}
        rowKey={(r) => r.cleanerId}
        onRowClick={onPick}
        emptyText="Здесь никого нет"
        columns={[
          {
            key: 'name',
            header: 'Клинер',
            cell: (r) => (
              <div>
                <div className="font-medium text-navy-900">{r.fullName}</div>
                <div className="text-xs text-navy-400">{r.brigade ?? 'Без бригады'}</div>
              </div>
            ),
          },
          { key: 'shifts', header: 'Смены', align: 'right', cell: (r) => r.shifts },
          {
            key: 'accrued',
            header: 'Начислено',
            align: 'right',
            cell: (r) => formatPrice(r.accrued),
          },
          {
            key: 'fines',
            header: 'Штрафы',
            align: 'right',
            cell: (r) =>
              r.fines > 0 ? (
                <span className="text-red-600">− {formatPrice(r.fines)}</span>
              ) : (
                <span className="text-navy-300">—</span>
              ),
          },
          {
            key: 'total',
            header: 'К выплате',
            align: 'right',
            cell: (r) => (
              <span className={`font-bold ${r.total < 0 ? 'text-red-600' : 'text-navy-900'}`}>
                {formatPrice(r.total)}
              </span>
            ),
          },
        ]}
        footer={
          rows.length > 0 ? (
            <tr className="border-t border-navy-100 font-bold text-navy-900">
              <td className="px-3 py-2">Итого</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.shifts}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPrice(totals.accrued)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-red-600">
                {totals.fines > 0 ? `− ${formatPrice(totals.fines)}` : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-green-700">
                {formatPrice(totals.total)}
              </td>
            </tr>
          ) : undefined
        }
      />

      <p className="mt-3 text-xs text-navy-400">
        Нажмите на строку, чтобы посмотреть конкретные смены и штрафы клинера.
      </p>
    </DetailModal>
  );
}

// ═══════════════════════════════════════════════════════════
//  Вкладка «Штрафы»
// ═══════════════════════════════════════════════════════════

function FinesSection() {
  const toast = useToast();
  const dialog = useDialog();
  const [period, setPeriod] = useState<Period>(() => monthRange());
  const {
    data: fines,
    loading,
    error,
    reload,
    setData: setFines,
  } = useFetch<Fine[]>(`/payroll/fines?from=${period.from}&to=${period.to}`, {
    deps: [period.from, period.to],
  });
  const { data: cleaners } = useFetch<Cleaner[]>('/cleaners');
  const [showAdd, setShowAdd] = useState(false);

  const removeFine = async (f: Fine) => {
    const ok = await dialog.confirm({
      title: 'Удалить штраф?',
      message: `Штраф ${formatPrice(f.amount)} (${f.reason}) будет удалён.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setFines((list) => (list ? list.filter((x) => x.id !== f.id) : list));
    toast.success('Штраф удалён');
    api.delete(`/payroll/fines/${f.id}`).catch((e: any) => {
      toast.error(e?.response?.data?.message || 'Не удалось удалить штраф');
      reload();
    });
  };

  const addFine = (payload: { cleanerId: string; amount: number; reason: string; date: string }) => {
    const c = (cleaners ?? []).find((x) => x.id === payload.cleanerId);
    const optimistic: Fine = {
      id: tempId(),
      cleanerId: payload.cleanerId,
      amount: payload.amount,
      reason: payload.reason,
      date: payload.date,
      cleaner: c ? { id: c.id, fullName: c.fullName, brigade: c.brigade ?? null } : undefined,
    };
    setFines((list) => (list ? [optimistic, ...list] : [optimistic]));
    toast.success('Штраф назначен');
    api
      .post('/payroll/fines', payload)
      .then(() => reload())
      .catch((e: any) => {
        toast.error(e?.response?.data?.message || 'Не удалось назначить штраф');
        setFines((list) => (list ? list.filter((x) => x.id !== optimistic.id) : list));
      });
  };

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100 text-red-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <div className="font-bold text-navy-900">Штрафы</div>
            <div className="text-xs text-navy-400">Уменьшают сумму к выплате клинеру</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter value={period} onChange={setPeriod} showMonthArrows />
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            <AlertTriangle className="h-4 w-4" />
            Штраф
          </button>
        </div>
      </div>

      {error ? (
        <ErrorState onRetry={reload} />
      ) : loading && !fines ? (
        <Spinner />
      ) : !fines || fines.length === 0 ? (
        <EmptyState text="За период штрафов не назначено" />
      ) : (
        <div className="space-y-2">
          {fines.map((f) => (
            /*
              Имя, сумма и кнопка — в первой строке, причина и дата — во второй.
              Раньше всё стояло в один ряд: на телефоне имени доставалось
              несколько десятков пикселей, и «Зулайхо» рассыпалась по букве
              на строку.
            */
            <div
              key={f.id}
              className="rounded-xl border border-red-100 bg-red-50/40 px-3.5 py-2.5"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-navy-900">
                  {f.cleaner?.fullName}
                </span>
                <span className="shrink-0 text-sm font-bold text-red-600">
                  − {formatPrice(f.amount)}
                </span>
                <button
                  onClick={() => removeFine(f)}
                  className="shrink-0 rounded-lg p-1.5 text-navy-300 hover:bg-red-100 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3 pl-6">
                <span className="min-w-0 text-sm text-navy-500">{f.reason}</span>
                <span className="shrink-0 text-xs text-navy-400">
                  {formatDate(f.date)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <FineModal
          cleaners={cleaners ?? []}
          defaultDate={
            todayISO() >= period.from && todayISO() <= period.to ? todayISO() : period.from
          }
          onClose={() => setShowAdd(false)}
          onSubmit={addFine}
        />
      )}
    </div>
  );
}

/** Модалка назначения штрафа */
function FineModal({
  cleaners,
  initialCleanerId,
  defaultDate,
  onClose,
  onSubmit,
}: {
  cleaners: Cleaner[];
  initialCleanerId?: string;
  defaultDate?: string;
  onClose: () => void;
  onSubmit: (payload: {
    cleanerId: string;
    amount: number;
    reason: string;
    date: string;
  }) => void;
}) {
  const [cleanerId, setCleanerId] = useState(initialCleanerId ?? '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(() => defaultDate ?? todayISO());

  // оптимистично: применяем и закрываем сразу, запрос — в фоне
  const submit = () => {
    onSubmit({
      cleanerId,
      amount: Number(amount),
      reason: reason.trim(),
      date,
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Штраф клинеру">
      <div className="space-y-3">
        <div>
          <label className="label">Клинер *</label>
          <select
            className="input"
            value={cleanerId}
            onChange={(e) => setCleanerId(e.target.value)}
          >
            <option value="">— выберите клинера —</option>
            {cleaners.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
                {c.brigade ? ` · ${c.brigade.name}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Сумма, сомони *</label>
            <input
              type="text"
              inputMode="numeric"
              className="input"
              value={amount}
              onChange={(e) =>
                setAmount(
                  e.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''),
                )
              }
              placeholder="50"
            />
          </div>
          <div>
            <label className="label">Дата</label>
            <DatePicker value={date} onChange={setDate} />
          </div>
        </div>
        <div>
          <label className="label">Причина *</label>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: опоздание на объект"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={!cleanerId || !Number(amount) || !reason.trim()}
            className="btn-primary"
          >
            Назначить штраф
          </button>
        </div>
      </div>
    </Modal>
  );
}
