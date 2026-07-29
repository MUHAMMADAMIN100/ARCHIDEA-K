import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
  Star,
  X,
  Pencil,
} from 'lucide-react';
import { api } from '../api/client';
import { useFetch, invalidate } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { PageHeader, Modal, Badge, EmptyState, Spinner, ErrorState } from '../components/ui';
import {
  DataTable,
  type Column,
  PeriodFilter,
  type Period,
  Tabs,
  SearchInput,
  MoneyInput,
  UserPicker,
} from '../components/common';
import {
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_STATUS_COLOR,
  STAGE_LABEL,
  formatPrice,
  formatVolume,
} from '../lib/labels';
import { formatDateTz, formatDateTimeTz, rangeOf } from '../lib/date';
import { userSeesAll } from '../types';
import type {
  Client,
  Order,
  Proposal,
  ProposalStatus,
  ProposalTemplate,
} from '../types';

const STATUSES: ProposalStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'];

/** Подстановки, доступные в теле шаблона КП (ТЗ 9.1) — сверено с template-render.ts бэкенда */
const PLACEHOLDER_HINTS: { key: string; hint: string }[] = [
  { key: 'client', hint: 'имя клиента' },
  { key: 'phone', hint: 'телефон клиента' },
  { key: 'address', hint: 'адрес объекта' },
  { key: 'area', hint: 'площадь/объём' },
  { key: 'pricePerSqm', hint: 'цена за единицу' },
  { key: 'total', hint: 'итоговая сумма' },
  { key: 'discount', hint: 'скидка' },
  { key: 'manager', hint: 'менеджер' },
  { key: 'date', hint: 'дата составления' },
  { key: 'validUntil', hint: 'срок действия' },
  { key: 'items', hint: 'список позиций' },
];

interface ProposalItemPayload {
  title: string;
  volume?: number;
  unitPrice?: number;
  amount?: number;
}
interface ProposalOverridesPayload {
  items?: ProposalItemPayload[];
  discount?: number;
  total?: number;
  address?: string;
  area?: number;
  pricePerSqm?: number;
}
interface CreateProposalPayload {
  clientId: string;
  orderId?: string;
  templateId?: string;
  overrides?: ProposalOverridesPayload;
}
interface TemplatePayload {
  name: string;
  intro?: string;
  body: string;
  conditions?: string;
  validDays: number;
  isDefault: boolean;
  isActive: boolean;
}

type TabKey = 'proposals' | 'templates';

export function Offers() {
  const { user } = useAuth();
  const canManageTemplates = userSeesAll(user); // = право proposals:templates на бэкенде
  const [tab, setTab] = useState<TabKey>('proposals');

  return (
    <div>
      <PageHeader
        title="Коммерческие предложения"
        subtitle="Отправка КП клиентам, статус и история отправки"
      />

      {canManageTemplates && (
        <Tabs<TabKey>
          items={[
            { value: 'proposals', label: 'Предложения' },
            { value: 'templates', label: 'Шаблоны' },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}

      <div className="mt-4">
        {tab === 'templates' && canManageTemplates ? (
          <TemplatesTab />
        ) : (
          <ProposalsTab />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Вкладка «Предложения»
// ═══════════════════════════════════════════════════════════

function ProposalsTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const seesAll = userSeesAll(user);

  const [period, setPeriod] = useState<Period>(rangeOf('all'));
  const [status, setStatus] = useState<ProposalStatus | ''>('');
  const [managerId, setManagerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const qs = new URLSearchParams();
  if (period.from) qs.set('from', period.from);
  if (period.to) qs.set('to', period.to);
  if (status) qs.set('status', status);
  if (seesAll && managerId) qs.set('managerId', managerId);

  const { data, loading, error, reload, setData } = useFetch<Proposal[]>(
    `/proposals?${qs.toString()}`,
    { deps: [period.from, period.to, status, managerId], pollMs: 20000 },
  );

  const rows = useMemo(() => {
    const list = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.clientName.toLowerCase().includes(q) ||
        (p.clientPhone ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  const markSent = async (p: Proposal) => {
    const ok = await dialog.confirm({
      title: `Отметить КП №${p.number} отправленным?`,
      message:
        'Фиксируется, кто и когда отправил КП клиенту. Если у КП есть заказ на раннем этапе, он перейдёт на этап «Коммерческое предложение».',
      confirmText: 'Отметить отправленным',
    });
    if (!ok) return;

    const before = p;
    setData((list) =>
      list?.map((x) =>
        x.id === p.id
          ? {
              ...x,
              status: 'SENT' as ProposalStatus,
              sentByName: user?.fullName ?? null,
              sentAt: new Date().toISOString(),
            }
          : x,
      ) ?? list,
    );
    toast.success(`КП №${p.number} отмечено отправленным`);
    try {
      await api.post(`/proposals/${p.id}/send`, {});
      if (p.orderId) invalidate('/orders');
    } catch (e: any) {
      setData((list) => list?.map((x) => (x.id === p.id ? before : x)) ?? list);
      toast.error(e?.response?.data?.message || 'Не удалось отметить КП отправленным');
    }
  };

  const changeStatus = async (p: Proposal, next: 'ACCEPTED' | 'REJECTED') => {
    const before = p;
    setData((list) =>
      list?.map((x) => (x.id === p.id ? { ...x, status: next } : x)) ?? list,
    );
    toast.success(
      next === 'ACCEPTED' ? `КП №${p.number} принято клиентом` : `КП №${p.number} отклонено`,
    );
    try {
      await api.patch(`/proposals/${p.id}/status`, { status: next });
    } catch (e: any) {
      setData((list) => list?.map((x) => (x.id === p.id ? before : x)) ?? list);
      toast.error(e?.response?.data?.message || 'Не удалось изменить статус КП');
    }
  };

  const removeProposal = async (p: Proposal) => {
    const ok = await dialog.confirm({
      title: `Удалить КП №${p.number}?`,
      message: `КП для «${p.clientName}» будет перенесено в корзину. Восстановить его можно в разделе «Корзина».`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    const prevList = data;
    setData((list) => list?.filter((x) => x.id !== p.id) ?? list);
    toast.success('КП перенесено в корзину');
    try {
      await api.delete(`/proposals/${p.id}`);
    } catch (e: any) {
      setData(prevList ?? null);
      toast.error(e?.response?.data?.message || 'Не удалось удалить КП');
    }
  };

  const columns: Column<Proposal>[] = [
    {
      key: 'number',
      title: '№',
      render: (p) => <span className="font-medium text-navy-900">№{p.number}</span>,
    },
    {
      key: 'client',
      title: 'Клиент',
      render: (p) => (
        <div>
          <div className="font-medium text-navy-900">{p.clientName}</div>
          {p.clientPhone && <div className="text-xs text-navy-400">{p.clientPhone}</div>}
        </div>
      ),
    },
    {
      key: 'order',
      title: 'Заказ',
      hideOnMobile: true,
      render: (p) => (p.orderId ? p.address || 'без адреса' : <span className="text-navy-300">без заказа</span>),
    },
    {
      key: 'total',
      title: 'Сумма',
      numeric: true,
      render: (p) => formatPrice(p.total),
    },
    {
      key: 'status',
      title: 'Статус',
      render: (p) => (
        <Badge className={PROPOSAL_STATUS_COLOR[p.status]}>
          {PROPOSAL_STATUS_LABEL[p.status]}
        </Badge>
      ),
    },
    {
      key: 'sent',
      title: 'Кто и когда отправил',
      hideOnMobile: true,
      render: (p) =>
        p.sentAt ? (
          <div>
            <div className="text-navy-700">{p.sentByName}</div>
            <div className="text-xs text-navy-400">{formatDateTimeTz(p.sentAt)}</div>
          </div>
        ) : (
          <span className="text-navy-300">не отправлено</span>
        ),
    },
    {
      key: 'validUntil',
      title: 'Действует до',
      hideOnMobile: true,
      render: (p) => (p.validUntil ? formatDateTz(p.validUntil) : '—'),
    },
    {
      key: 'actions',
      title: '',
      render: (p) => (
        <div className="flex items-center justify-end gap-1">
          {p.status === 'DRAFT' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                markSent(p);
              }}
              className="rounded-lg p-1.5 text-navy-400 transition hover:bg-sky-50 hover:text-sky-600"
              title="Отметить отправленным"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
          {p.status === 'SENT' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeStatus(p, 'ACCEPTED');
                }}
                className="rounded-lg p-1.5 text-navy-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                title="Принято клиентом"
              >
                <CheckCircle2 className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeStatus(p, 'REJECTED');
                }}
                className="rounded-lg p-1.5 text-navy-400 transition hover:bg-rose-50 hover:text-rose-600"
                title="Отклонено клиентом"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeProposal(p);
            }}
            className="rounded-lg p-1.5 text-navy-400 transition hover:bg-rose-50 hover:text-rose-600"
            title="Удалить в корзину"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <select
          className="input max-w-[180px]"
          value={status}
          onChange={(e) => setStatus(e.target.value as ProposalStatus | '')}
        >
          <option value="">Все статусы</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROPOSAL_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {seesAll && (
          <div className="min-w-[200px]">
            <UserPicker value={managerId} onChange={setManagerId} placeholder="Все менеджеры" />
          </div>
        )}
        <div className="min-w-[200px] flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по клиенту или телефону" />
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary shrink-0">
          <Plus className="h-4 w-4" />
          Новое КП
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={loading}
        error={error}
        onRetry={reload}
        onRowClick={(p) => navigate(`/offers/${p.id}`)}
        emptyText="Коммерческих предложений пока нет. Нажмите «Новое КП», чтобы подготовить первое."
      />

      {showCreate && <CreateOfferModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

/** Строка позиции сметы в форме создания — суммы вводятся строками, чтобы поле можно было очистить */
interface ItemDraft {
  title: string;
  volume: string;
  unitPrice: string;
}

const itemAmount = (i: ItemDraft) =>
  Math.round((Number(i.volume) || 0) * (Number(i.unitPrice) || 0));

function CreateOfferModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<Client | null>(null);
  const [orderId, setOrderId] = useState('');

  const { data: clientDetail } = useFetch<Client>(
    client ? `/clients/${client.id}` : null,
    { deps: [client?.id] },
  );
  const { data: templates } = useFetch<ProposalTemplate[]>('/proposal-templates');
  const [templateId, setTemplateId] = useState('');

  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [pricePerSqm, setPricePerSqm] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [manualTotal, setManualTotal] = useState(false);
  const [total, setTotal] = useState(0);
  const [saving, setSaving] = useState(false);

  // поиск клиента с задержкой — не долбим бэкенд на каждое нажатие
  useEffect(() => {
    if (!clientQuery.trim() || client) {
      setClientResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api
        .get<Client[]>(`/clients?search=${encodeURIComponent(clientQuery.trim())}`)
        .then((r) => setClientResults(r.data.slice(0, 8)))
        .catch(() => setClientResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [clientQuery, client]);

  // основной шаблон подставляется по умолчанию, как только список загрузился
  useEffect(() => {
    if (templates && !templateId) {
      const def = templates.find((t) => t.isDefault && t.isActive) ?? templates.find((t) => t.isActive);
      if (def) setTemplateId(def.id);
    }
  }, [templates, templateId]);

  // выбор заказа клиента — подставляет адрес, площадь и цену как отправную точку
  const selectOrder = (id: string) => {
    setOrderId(id);
    const order = clientDetail?.orders?.find((o) => o.id === id);
    if (order) {
      setAddress(order.address ?? '');
      setArea(order.area ? String(order.area) : '');
      setPricePerSqm(order.pricePerSqm ?? order.finalPrice ?? 0);
    }
  };

  const pickClient = (c: Client) => {
    setClient(c);
    setClientQuery(c.fullName);
    setClientResults([]);
    setOrderId('');
    setAddress('');
    setArea('');
    setPricePerSqm(0);
  };

  const clearClient = () => {
    setClient(null);
    setClientQuery('');
    setOrderId('');
  };

  const addItem = () => setItems((x) => [...x, { title: '', volume: '', unitPrice: '' }]);
  const updateItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((x) => x.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems((x) => x.filter((_, i) => i !== idx));

  const itemsTotal = items.reduce((s, i) => s + itemAmount(i), 0);
  const areaTotal = (Number(area) || 0) * pricePerSqm;
  const autoTotal = items.length > 0 ? itemsTotal : areaTotal;
  const effectiveTotal = manualTotal ? total : Math.max(0, autoTotal - discount);

  const templateOptions = (templates ?? []).filter((t) => t.isActive);
  const canSubmit = !!client && !!templateId && !saving;

  const submit = async () => {
    if (!client) return;
    setSaving(true);
    const validItems = items
      .filter((i) => i.title.trim())
      .map<ProposalItemPayload>((i) => ({
        title: i.title.trim(),
        volume: i.volume ? Number(i.volume) : undefined,
        unitPrice: i.unitPrice ? Number(i.unitPrice) : undefined,
        amount: itemAmount(i) || undefined,
      }));
    const payload: CreateProposalPayload = {
      clientId: client.id,
      orderId: orderId || undefined,
      templateId: templateId || undefined,
      overrides: {
        address: address.trim() || undefined,
        area: area ? Number(area) : undefined,
        pricePerSqm: pricePerSqm || undefined,
        discount: discount || undefined,
        items: validItems.length ? validItems : undefined,
        total: manualTotal ? total : undefined,
      },
    };
    try {
      const created = (await api.post<Proposal>('/proposals', payload)).data;
      toast.success(`КП №${created.number} создано`);
      onClose();
      navigate(`/offers/${created.id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось создать КП');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Новое коммерческое предложение" wide>
      <div className="space-y-4">
        {/* Клиент */}
        <div>
          <label className="label">Клиент *</label>
          {client ? (
            <div className="flex items-center justify-between rounded-xl border border-navy-200 bg-navy-50/60 px-3 py-2.5">
              <div>
                <div className="font-medium text-navy-900">{client.fullName}</div>
                <div className="text-xs text-navy-400">{client.phone}</div>
              </div>
              <button onClick={clearClient} className="text-navy-400 hover:text-navy-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                className="input"
                placeholder="Начните вводить имя или телефон клиента"
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
              />
              {(searching || clientResults.length > 0) && clientQuery.trim() && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-navy-100 bg-white shadow-card">
                  {searching && (
                    <div className="px-3 py-2 text-sm text-navy-400">Поиск…</div>
                  )}
                  {!searching && clientResults.length === 0 && (
                    <div className="px-3 py-2 text-sm text-navy-400">
                      Клиент не найден — проверьте имя в базе клиентов
                    </div>
                  )}
                  {clientResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickClient(c)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-navy-50"
                    >
                      <div className="font-medium text-navy-900">{c.fullName}</div>
                      <div className="text-xs text-navy-400">{c.phone}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Заказ клиента (если есть) */}
        {client && (
          <div>
            <label className="label">Заказ (необязательно)</label>
            <select
              className="input"
              value={orderId}
              onChange={(e) => selectOrder(e.target.value)}
            >
              <option value="">— без привязки к заказу —</option>
              {(clientDetail?.orders ?? []).map((o: Order) => (
                <option key={o.id} value={o.id}>
                  {STAGE_LABEL[o.stage]} · {formatVolume(o)}
                  {o.address ? ` · ${o.address}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Шаблон */}
        <div>
          <label className="label">Шаблон текста *</label>
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— выберите шаблон —</option>
            {templateOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? ' (основной)' : ''}
              </option>
            ))}
          </select>
          {templateOptions.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Активных шаблонов нет — создайте их на вкладке «Шаблоны».
            </p>
          )}
        </div>

        {/* Объект */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="label">Адрес объекта</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <label className="label">Площадь, м²</label>
            <input
              type="number"
              className="input"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Цена за м²</label>
            <MoneyInput value={pricePerSqm} onChange={setPricePerSqm} />
          </div>
          <div>
            <label className="label">Скидка</label>
            <MoneyInput value={discount} onChange={setDiscount} />
          </div>
        </div>

        {/* Позиции сметы */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label !mb-0">Позиции сметы (необязательно)</label>
            <button type="button" onClick={addItem} className="btn-ghost !px-2 !py-1 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Позиция
            </button>
          </div>
          {items.length === 0 ? (
            <p className="text-xs text-navy-400">
              Без позиций сумма считается по площади и цене за м². Добавьте позиции, если нужна
              детальная смета.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-navy-100">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-navy-50 text-xs uppercase tracking-wide text-navy-400">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Наименование</th>
                    <th className="px-2 py-2 text-left font-medium">Объём</th>
                    <th className="px-2 py-2 text-left font-medium">Цена за ед.</th>
                    <th className="px-2 py-2 text-right font-medium">Сумма</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className="border-t border-navy-50">
                      <td className="px-2 py-1.5">
                        <input
                          className="input py-1.5"
                          value={it.title}
                          onChange={(e) => updateItem(idx, { title: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="input py-1.5"
                          inputMode="decimal"
                          value={it.volume}
                          onChange={(e) =>
                            updateItem(idx, { volume: e.target.value.replace(/[^\d.]/g, '') })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="input py-1.5"
                          inputMode="numeric"
                          value={it.unitPrice}
                          onChange={(e) =>
                            updateItem(idx, { unitPrice: e.target.value.replace(/[^\d.]/g, '') })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-navy-700">
                        {formatPrice(itemAmount(it))}
                      </td>
                      <td className="px-1">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="text-navy-300 hover:text-rose-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Итог */}
        <div className="space-y-1.5 rounded-xl bg-navy-50 p-3 text-sm">
          <div className="flex justify-between text-navy-500">
            <span>Расчёт по {items.length > 0 ? 'позициям' : 'площади и цене'}</span>
            <span className="tabular-nums">{formatPrice(autoTotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-navy-500">
              <span>Скидка</span>
              <span className="tabular-nums">− {formatPrice(discount)}</span>
            </div>
          )}
          <label className="flex items-center gap-2 pt-1 text-navy-600">
            <input
              type="checkbox"
              className="h-4 w-4 accent-navy-500"
              checked={manualTotal}
              onChange={(e) => {
                setManualTotal(e.target.checked);
                if (e.target.checked) setTotal(Math.max(0, autoTotal - discount));
              }}
            />
            Задать итоговую сумму вручную
          </label>
          {manualTotal && <MoneyInput value={total} onChange={setTotal} />}
          <div className="flex justify-between border-t border-navy-200 pt-1.5 text-base font-bold text-navy-900">
            <span>Итого в КП</span>
            <span className="tabular-nums">{formatPrice(effectiveTotal)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button onClick={submit} disabled={!canSubmit} className="btn-primary">
            {saving ? 'Создание…' : 'Создать КП'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════
//  Вкладка «Шаблоны» (право proposals:templates)
// ═══════════════════════════════════════════════════════════

function TemplatesTab() {
  const toast = useToast();
  const dialog = useDialog();
  const { data, loading, error, reload, setData } = useFetch<ProposalTemplate[]>(
    '/proposal-templates',
  );
  const [editing, setEditing] = useState<ProposalTemplate | 'new' | null>(null);

  const removeTemplate = async (t: ProposalTemplate) => {
    const ok = await dialog.confirm({
      title: `Удалить шаблон «${t.name}»?`,
      message:
        'Шаблон будет перенесён в корзину. Уже созданные по нему КП не изменятся — в них сохранён снимок текста.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    const prev = data;
    setData((list) => list?.filter((x) => x.id !== t.id) ?? list);
    toast.success('Шаблон перенесён в корзину');
    try {
      await api.delete(`/proposal-templates/${t.id}`);
    } catch (e: any) {
      setData(prev ?? null);
      toast.error(e?.response?.data?.message || 'Не удалось удалить шаблон');
    }
  };

  if (error && !data) return <ErrorState onRetry={reload} />;
  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setEditing('new')} className="btn-primary">
          <Plus className="h-4 w-4" />
          Новый шаблон
        </button>
      </div>

      {(data ?? []).length === 0 ? (
        <EmptyState text="Шаблонов КП пока нет. Создайте первый — без него менеджеры не смогут отправлять коммерческие предложения." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((t) => (
            <div key={t.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-bold leading-tight text-navy-900">{t.name}</h4>
                {t.isDefault && (
                  <Badge className="border border-amber-200 bg-amber-50 text-amber-700">
                    <Star className="mr-1 h-3 w-3" /> Основной
                  </Badge>
                )}
              </div>
              {!t.isActive && (
                <Badge className="mt-1.5 w-fit border border-slate-200 bg-slate-100 text-slate-600">
                  Неактивен
                </Badge>
              )}
              {t.intro && (
                <p className="mt-2 line-clamp-3 text-sm text-navy-500">{t.intro}</p>
              )}
              <p className="mt-2 text-xs text-navy-400">
                Действует {t.validDays} {t.validDays === 1 ? 'день' : 'дней'} с даты составления
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setEditing(t)}
                  className="btn-ghost !px-2.5 !py-1.5 text-xs"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Изменить
                </button>
                <button
                  onClick={() => removeTemplate(t)}
                  className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TemplateModal
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: ProposalTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(template?.name ?? '');
  const [intro, setIntro] = useState(template?.intro ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [conditions, setConditions] = useState(template?.conditions ?? '');
  const [validDays, setValidDays] = useState(template?.validDays ?? 7);
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    const payload: TemplatePayload = {
      name: name.trim(),
      intro: intro.trim() || undefined,
      body,
      conditions: conditions.trim() || undefined,
      validDays,
      isDefault,
      isActive,
    };
    try {
      if (template) {
        await api.patch(`/proposal-templates/${template.id}`, payload);
        toast.success('Шаблон обновлён');
      } else {
        await api.post('/proposal-templates', payload);
        toast.success('Шаблон создан');
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить шаблон');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={template ? 'Правка шаблона КП' : 'Новый шаблон КП'} wide>
      <div className="space-y-3">
        <div>
          <label className="label">Название шаблона *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {/* Подсказка по подстановкам — иначе пользователь о них не узнает */}
        <div className="rounded-xl border border-navy-100 bg-navy-50/60 p-3 text-xs text-navy-600">
          <div className="mb-1.5 font-semibold text-navy-700">
            В тексте можно использовать подстановки — при отправке они заменятся реальными данными:
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {PLACEHOLDER_HINTS.map((p) => (
              <span key={p.key}>
                <code className="rounded bg-white px-1 py-0.5 font-mono text-navy-800">
                  {`{{${p.key}}}`}
                </code>{' '}
                — {p.hint}
              </span>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Вступление (необязательно)</label>
          <textarea
            className="input min-h-[70px]"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            placeholder="Уважаемый(ая) {{client}}! Благодарим за интерес к нашим услугам…"
          />
        </div>

        <div>
          <label className="label">Основной текст *</label>
          <textarea
            className="input min-h-[140px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              'Адрес объекта: {{address}}\nОбъём работ: {{area}}\nЦена за единицу: {{pricePerSqm}} сомони\n\n{{items}}\n\nИтоговая стоимость: {{total}} сомони'
            }
          />
        </div>

        <div>
          <label className="label">Условия (необязательно)</label>
          <textarea
            className="input min-h-[70px]"
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            placeholder="Предложение действительно до {{validUntil}}. Подготовил: {{manager}}, {{date}}."
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Срок действия КП, дней</label>
            <input
              type="number"
              min={0}
              max={365}
              className="input"
              value={validDays}
              onChange={(e) => setValidDays(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm text-navy-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-navy-500"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Сделать основным (используется по умолчанию)
            </label>
            <label className="flex items-center gap-2 text-sm text-navy-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-navy-500"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Активен (доступен для выбора в новых КП)
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || !body.trim() || saving}
            className="btn-primary"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
