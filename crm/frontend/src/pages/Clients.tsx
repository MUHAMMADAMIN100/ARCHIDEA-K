import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Download, Repeat2, X } from 'lucide-react';
import { api } from '../api/client';
import { useFetch, mutateCache } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Badge, Modal, ErrorState } from '../components/ui';
import { useToast } from '../components/Toast';
import { Column, DataTable, SearchInput } from '../components/common';
import { DrillValue, DetailModal, DetailStats, DetailTable } from '../components/Drilldown';
import {
  TAG_LABEL,
  TAG_COLOR,
  SOURCE_LABEL,
  SOURCE_ORDER,
  cleaningTypeForKey,
  TYPE_LABEL,
  ACTIVE_TYPES,
  DIRT_LABEL,
  DIRT_ORDER,
  STAGE_COLOR,
  STAGE_LABEL,
  formatDate,
  formatPrice,
} from '../lib/labels';
import { formatPhone } from '../lib/contact';
import { tempId, nowISO } from '../lib/util';
import { isValidPersonName, isValidPhone } from '../lib/contact';
import { NameInput, PhoneInput } from '../components/ContactFields';
import { userSeesAll } from '../types';
import type {
  BoardColumn,
  CleaningType,
  Client,
  ClientTag,
  DirtLevel,
  LeadSource,
  Manager,
  Order,
  Tariffs,
} from '../types';

const TAGS: ClientTag[] = ['VIP', 'REGULAR', 'POTENTIAL', 'REFUSED'];
// один общий порядок источников на весь проект — см. lib/labels.ts
const SOURCES = SOURCE_ORDER;

type OrdersFilter = 'all' | 'repeat' | 'none';

/** Данные заявки при добавлении клиента (если создаём заявку в воронке) */
export interface NewOrderInput {
  cleaningType: CleaningType;
  /** ключ услуги из справочника — своя услуга директора тоже сюда */
  serviceKey?: string;
  /** ещё услуги в этой же заявке (ТЗ 1.3): сервер сам посчитает цены */
  additionalServices?: { key: string; qty: number }[];
  dirtLevel?: DirtLevel;
  area: number;
  seats?: number;
  estimatedPrice: number;
  /** ТЗ 5 — цена за единицу и итог */
  pricePerSqm?: number;
  finalPrice?: number;
}

export function Clients() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  // ТЗ 9.4 — повторные клиенты видны и фильтруются отдельно
  const [ordersFilter, setOrdersFilter] = useState<OrdersFilter>('all');
  const [showAdd, setShowAdd] = useState(false);
  // чьи заказы показываем в расшифровке счётчика
  const [ordersFor, setOrdersFor] = useState<Client | null>(null);
  const toast = useToast();

  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (tag) query.set('tag', tag);
  if (source) query.set('source', source);
  query.set('sort', sort);
  if (ordersFilter === 'repeat') query.set('repeat', 'true');

  const { data, loading, error, reload, setData } = useFetch<Client[]>(
    `/clients?${query.toString()}`,
    { deps: [search, tag, source, sort, ordersFilter], pollMs: 15000 },
  );

  // «Без заказов» бэкенд не фильтрует отдельным параметром — считаем на клиенте
  // по уже загруженному списку, дублировать эндпоинт ради одного среза незачем
  const rows = (data ?? []).filter((c) =>
    ordersFilter === 'none' ? (c._count?.orders ?? 0) === 0 : true,
  );

  // оптимистично: клиент появляется в списке сразу; при необходимости
  // создаём и заявку в воронке (этап «Новая заявка»)
  const createClient = async (
    payload: {
      fullName: string;
      phone: string;
      source: LeadSource;
      managerId?: string;
      /** постоянная скидка клиента в сомони */
      discount?: number;
      extraPhones?: string[];
      labels?: string[];
      sourceDetail?: string;
    },
    managerName: string | null,
    order: NewOrderInput | null,
  ) => {
    const id = tempId();
    const optimistic: Client = {
      id,
      fullName: payload.fullName,
      phone: payload.phone,
      source: payload.source,
      tags: [],
      labels: payload.labels ?? [],
      lastContactAt: nowISO(),
      managerId: payload.managerId,
      manager: managerName
        ? { id: payload.managerId ?? '', fullName: managerName }
        : null,
      _count: { orders: order ? 1 : 0 },
    };
    setData((list) => (list ? [optimistic, ...list] : [optimistic]));
    try {
      const client = (await api.post<Client>('/clients', payload)).data;
      if (order) {
        const created = (
          await api.post<Order>('/orders', {
            clientId: client.id,
            source: payload.source,
            managerId: payload.managerId,
            ...order,
          })
        ).data;
        /*
         * Мгновенно показываем заявку в кэше воронки, если он уже загружен.
         * Сумму на этапе тоже поправляем: иначе карточка появится, а «Сумма»
         * в шапке колонки останется прежней до фонового обновления.
         */
        mutateCache<BoardColumn[]>('/orders/board', (cols) =>
          cols.map((c) =>
            c.stage === 'NEW'
              ? {
                  ...c,
                  orders: [created, ...c.orders],
                  amount:
                    (c.amount ?? 0) +
                    (created.finalPrice ?? created.estimatedPrice ?? 0),
                }
              : c,
          ),
        );
      }
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось создать клиента');
      setData((list) => (list ? list.filter((c) => c.id !== id) : list));
    }
  };

  const exportCsv = async () => {
    const res = await api.get('/clients/export', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clients.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<Client>[] = [
    {
      key: 'client',
      title: 'Клиент',
      render: (c) => (
        <div>
          <div className="flex items-center gap-1.5 font-semibold text-navy-900">
            {c.fullName}
            {c.isRepeat && (
              <Badge className="bg-teal-100 text-teal-700">
                <Repeat2 className="mr-0.5 -ml-0.5 inline h-3 w-3" />
                Повторный
              </Badge>
            )}
          </div>
          <div className="text-xs text-navy-600">{formatPhone(c.phone)}</div>
        </div>
      ),
    },
    {
      key: 'source',
      title: 'Источник',
      hideOnMobile: true,
      render: (c) => <span className="text-navy-600">{SOURCE_LABEL[c.source]}</span>,
    },
    {
      key: 'tags',
      title: 'Теги',
      hideOnMobile: true,
      render: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.tags.length === 0 && !(c.labels ?? []).length ? (
            <span className="text-navy-600">—</span>
          ) : (
            <>
              {c.tags.map((t) => (
                <Badge key={t} className={TAG_COLOR[t]}>
                  {TAG_LABEL[t]}
                </Badge>
              ))}
              {(c.labels ?? []).map((l) => (
                <Badge key={l} className="bg-navy-100 text-navy-600">
                  {l}
                </Badge>
              ))}
            </>
          )}
        </div>
      ),
    },
    ...(userSeesAll(user)
      ? [
          {
            key: 'manager',
            title: 'Менеджер',
            hideOnMobile: true,
            render: (c: Client) => (
              <span className="text-navy-600">{c.manager?.fullName ?? '—'}</span>
            ),
          } as Column<Client>,
        ]
      : []),
    {
      key: 'orders',
      title: 'Заказов (оплачено)',
      numeric: true,
      // клик по строке уводит в карточку клиента, а по цифре — показывает
      // его заказы прямо здесь: не теряется место в отфильтрованном списке
      render: (c) => (
        <span className="text-navy-700" onClick={(e) => e.stopPropagation()}>
          <DrillValue
            align="right"
            disabled={(c._count?.orders ?? 0) === 0}
            title={`Заказы клиента: ${c.fullName}`}
            onClick={() => setOrdersFor(c)}
          >
            {c._count?.orders ?? 0}
            {(c.paidOrdersCount ?? 0) > 0 && (
              <span className="ml-1 text-xs text-emerald-600">
                ({c.paidOrdersCount} опл.)
              </span>
            )}
          </DrillValue>
        </span>
      ),
    },
    {
      key: 'lastOrderAt',
      title: 'Последний заказ',
      hideOnMobile: true,
      render: (c) => <span className="text-navy-600">{formatDate(c.lastOrderAt)}</span>,
    },
    {
      key: 'lastContactAt',
      title: 'Контакт',
      render: (c) => <span className="text-navy-600">{formatDate(c.lastContactAt)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="База клиентов"
        subtitle="Все обращения фиксируются здесь"
        action={
          <div className="flex gap-2">
            <button onClick={exportCsv} className="btn-ghost">
              <Download className="h-4 w-4" />
              Экспорт
            </button>
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus className="h-4 w-4" />
              Добавить
            </button>
          </div>
        }
      />

      {/* Фильтры */}
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-[200px] flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по имени или телефону" />
        </div>
        <select className="input max-w-[180px]" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Все теги</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>{TAG_LABEL[t]}</option>
          ))}
        </select>
        <select className="input max-w-[180px]" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Все источники</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
          ))}
        </select>
        <select className="input max-w-[180px]" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="recent">Сначала недавние</option>
          <option value="name">По имени</option>
        </select>
        <select
          className="input max-w-[200px]"
          value={ordersFilter}
          onChange={(e) => setOrdersFilter(e.target.value as OrdersFilter)}
        >
          <option value="all">Все клиенты</option>
          <option value="repeat">Только повторные</option>
          <option value="none">Без заказов</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={loading}
        error={error}
        onRetry={reload}
        onRowClick={(c) => navigate(`/clients/${c.id}`)}
        perPage={15}
        emptyText="Клиенты не найдены — измените фильтры или добавьте нового клиента"
      />

      {showAdd && (
        <AddClientModal
          onClose={() => setShowAdd(false)}
          onCreate={createClient}
          isDirector={userSeesAll(user)}
          knownLabels={[...new Set((data ?? []).flatMap((c) => c.labels ?? []))]}
        />
      )}

      {ordersFor && (
        <ClientOrdersModal
          client={ordersFor}
          onOpenCard={() => navigate(`/clients/${ordersFor.id}`)}
          onClose={() => setOrdersFor(null)}
        />
      )}
    </div>
  );
}

export function AddClientModal({
  onClose,
  onCreate,
  isDirector,
  knownLabels = [],
}: {
  /** уже использованные теги — для подсказки при вводе */
  knownLabels?: string[];
  onClose: () => void;
  onCreate: (
    payload: {
      fullName: string;
      phone: string;
      source: LeadSource;
      managerId?: string;
      /** постоянная скидка клиента в сомони */
      discount?: number;
      extraPhones?: string[];
      labels?: string[];
      sourceDetail?: string;
    },
    managerName: string | null,
    order: NewOrderInput | null,
  ) => void;
  isDirector: boolean;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  // запасные номера «на всякий случай» (ТЗ 1.1)
  const [extraPhones, setExtraPhones] = useState<string[]>([]);
  // свободные теги (ТЗ 1.2) — в дополнение к единственному статусу
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState('');
  const [source, setSource] = useState<LeadSource>('CALL');
  // «От кого» — рекомендатель или партнёр (ТЗ 1.4)
  const [sourceDetail, setSourceDetail] = useState('');
  // постоянная скидка: подставляется в новые заказы клиента
  const [discount, setDiscount] = useState('');
  const [managerId, setManagerId] = useState('');
  // заявка в воронке
  const [makeOrder, setMakeOrder] = useState(true);
  // ещё услуги в заявке (ТЗ 1.3): ключ + объём, цена подставится из справочника
  const [moreServices, setMoreServices] = useState<
    { key: string; qty: string }[]
  >([]);
  const [serviceKey, setServiceKey] = useState('GENERAL');
  const [dirtLevel, setDirtLevel] = useState<DirtLevel>('LIGHT');
  const [area, setArea] = useState('');
  const [seats, setSeats] = useState('');
  const [price, setPrice] = useState('');
  // ТЗ 5: цена за единицу и автоматический расчёт суммы
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [manualPrice, setManualPrice] = useState(false);
  const { data: tariffs } = useFetch<Tariffs>('/tariffs');
  const { data: managers } = useFetch<Manager[]>(
    isDirector ? '/users/managers' : null,
  );
  /*
   * Список услуг — из справочника, а не из зашитой тройки: услуга,
   * заведённая директором, должна быть доступна при оформлении клиента.
   */
  const serviceOptions = (tariffs?.tariffs ?? []).filter(
    (t) => t.isActive !== false,
  );
  const tariff = serviceOptions.find((t) => t.key === serviceKey);
  const isFurniture = tariff
    ? tariff.unit !== 'м²'
    : serviceKey === 'FURNITURE';
  const hasLevels = tariff ? tariff.hasLevels : serviceKey !== 'FURNITURE';

  /*
   * ТЗ 5: цена за единицу берётся из услуги по степени загрязнения,
   * сумма считается как объём × цена. Пока менеджер не правил итог руками,
   * он пересчитывается автоматически.
   */
  const suggestedUnitPrice = !tariff
    ? 0
    : !tariff.hasLevels
      ? tariff.priceMedium || tariff.pricePerSqm
      : dirtLevel === 'LIGHT'
        ? tariff.priceLight
        : dirtLevel === 'HEAVY'
          ? tariff.priceHeavy
          : tariff.priceMedium;

  useEffect(() => {
    if (!manualPrice) setPricePerUnit(String(suggestedUnitPrice || ''));
  }, [suggestedUnitPrice, manualPrice]);

  const units = Math.round(Number(isFurniture ? seats : area)) || 0;
  const unitPrice = Math.round(Number(pricePerUnit)) || 0;
  // строки «ещё услуг»: цена из справочника по выбранной степени загрязнения
  const moreRows = moreServices.map((r) => {
    const t = serviceOptions.find((x) => x.key === r.key);
    const qty = Math.max(0, Math.round(Number(r.qty) || 0));
    const price = !t
      ? 0
      : !t.hasLevels
        ? t.priceMedium || t.pricePerSqm
        : dirtLevel === 'LIGHT'
          ? t.priceLight
          : dirtLevel === 'HEAVY'
            ? t.priceHeavy
            : t.priceMedium;
    return {
      ...r,
      title: t?.title ?? r.key,
      unit: t?.unit ?? 'м²',
      qtyN: qty,
      total: qty * (price || 0),
    };
  });
  const moreSum = moreRows.reduce((sum, r) => sum + r.total, 0);
  const computed = units * unitPrice + moreSum;

  useEffect(() => {
    if (!manualPrice) setPrice(computed ? String(computed) : '');
  }, [computed, manualPrice]);

  // кнопку не даём нажать, пока данные некорректны — сервер их всё равно отклонит
  const canSubmit = isValidPersonName(fullName) && isValidPhone(phone);

  const submit = () => {
    if (!canSubmit) return;
    const managerName =
      (managers ?? []).find((m) => m.id === managerId)?.fullName ?? null;
    const toInt = (s: string) => Math.round(Number(s)) || 0;
    const order: NewOrderInput | null = makeOrder
      ? {
          cleaningType: cleaningTypeForKey(serviceKey),
          serviceKey,
          additionalServices: moreRows
            .filter((r) => r.qtyN > 0)
            .map((r) => ({ key: r.key, qty: r.qtyN })),
          dirtLevel: hasLevels ? dirtLevel : undefined,
          area: isFurniture ? 0 : toInt(area),
          seats: isFurniture ? toInt(seats) : undefined,
          estimatedPrice: toInt(price),
          pricePerSqm: unitPrice || undefined,
          finalPrice: toInt(price) || undefined,
        }
      : null;
    onCreate(
      {
        fullName,
        phone,
        source,
        managerId: managerId || undefined,
        discount: Math.max(0, Math.round(Number(discount) || 0)),
        extraPhones: extraPhones.filter((p) => isValidPhone(p)),
        labels,
        sourceDetail: sourceDetail.trim() || undefined,
      },
      managerName,
      order,
    );
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Новый клиент">
      <div className="space-y-3">
        <NameInput value={fullName} onChange={setFullName} autoFocus />
        <PhoneInput value={phone} onChange={setPhone} required />

        {/* Запасные номера (ТЗ 1.1): необязательные, «на всякий случай» */}
        {extraPhones.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <PhoneInput
                value={p}
                onChange={(v) =>
                  setExtraPhones((prev) =>
                    prev.map((x, j) => (j === i ? v : x)),
                  )
                }
              />
            </div>
            <button
              type="button"
              onClick={() =>
                setExtraPhones((prev) => prev.filter((_, j) => j !== i))
              }
              className="mt-2 shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
              aria-label="Убрать номер"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setExtraPhones((prev) => [...prev, ''])}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          + ещё номер телефона
        </button>
        <div>
          {/*
            Постоянная скидка клиента. Подставляется в его новые заказы,
            в самом заказе её можно изменить — так постоянному клиенту не
            нужно каждый раз вписывать скидку заново.
          */}
          <label className="label">Постоянная скидка, сомони</label>
          <input
            type="number"
            min={0}
            className="input"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            placeholder="0 — без скидки"
          />
        </div>
        <div>
          <label className="label">Источник</label>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
            ))}
          </select>
          {/* «От кого» (ТЗ 1.4): рекомендатель или партнёр */}
          <input
            className="input mt-2"
            value={sourceDetail}
            maxLength={120}
            onChange={(e) => setSourceDetail(e.target.value)}
            placeholder="От кого — например: От Анисы, От Ибодат"
          />
        </div>

        {/* Свободные теги (ТЗ 1.2): свой текст, сколько угодно */}
        <div>
          <label className="label">Теги</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {labels.map((l) => (
              <span
                key={l}
                className="inline-flex items-center gap-1 rounded-lg bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-700"
              >
                {l}
                <X
                  className="h-3 w-3 cursor-pointer text-navy-600 hover:text-red-600"
                  onClick={() =>
                    setLabels((prev) => prev.filter((x) => x !== l))
                  }
                />
              </span>
            ))}
            <input
              className="input h-9 w-40"
              value={labelInput}
              maxLength={40}
              list="client-label-hints"
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = labelInput.trim();
                  if (v && !labels.includes(v)) setLabels((p) => [...p, v]);
                  setLabelInput('');
                }
              }}
              onBlur={() => {
                const v = labelInput.trim();
                if (v && !labels.includes(v)) setLabels((p) => [...p, v]);
                setLabelInput('');
              }}
              placeholder="тег и Enter"
            />
            {/* подсказка из уже использованных тегов */}
            <datalist id="client-label-hints">
              {knownLabels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>
        </div>
        {isDirector && (
          <div>
            <label className="label">Ответственный менеджер</label>
            <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">— не назначен —</option>
              {(managers ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.fullName}</option>
              ))}
            </select>
          </div>
        )}

        {/* Заявка в воронке */}
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2.5">
          <input
            type="checkbox"
            checked={makeOrder}
            onChange={(e) => setMakeOrder(e.target.checked)}
            className="h-4 w-4 accent-navy-500"
          />
          <span className="text-sm font-medium text-navy-800">
            Создать заявку в воронке (этап «Новая заявка»)
          </span>
        </label>

        {makeOrder && (
          <div className="space-y-3 rounded-xl border border-navy-100 p-3">
            <div>
              <label className="label">Услуга</label>
              <select
                className="input"
                value={serviceKey}
                onChange={(e) => setServiceKey(e.target.value)}
              >
                {serviceOptions.length > 0
                  ? serviceOptions.map((t) => (
                      <option key={t.key} value={t.key}>{t.title}</option>
                    ))
                  : ACTIVE_TYPES.map((t) => (
                      <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                    ))}
              </select>

              {/* Ещё услуги в этой же заявке (ТЗ 1.3) */}
              {moreRows.map((r, i) => (
                <div key={i} className="mt-2 rounded-lg border border-navy-100 p-2">
                  <select
                    className="input h-9 w-full"
                    value={r.key}
                    onChange={(e) =>
                      setMoreServices((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, key: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {serviceOptions.map((t) => (
                      <option key={t.key} value={t.key}>{t.title}</option>
                    ))}
                  </select>
                  <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    className="input h-9 w-20"
                    value={r.qty}
                    onChange={(e) =>
                      setMoreServices((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, qty: e.target.value } : x,
                        ),
                      )
                    }
                    aria-label="Объём"
                  />
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-navy-600">
                    {r.total > 0 ? formatPrice(r.total) : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setMoreServices((prev) =>
                        prev.filter((_, j) => j !== i),
                      )
                    }
                    className="shrink-0 rounded-lg p-1 text-navy-600 hover:text-red-600"
                    aria-label="Убрать услугу"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setMoreServices((prev) => [
                    ...prev,
                    {
                      key:
                        serviceOptions.find((t) => t.key !== serviceKey)?.key ??
                        serviceKey,
                      qty: '1',
                    },
                  ])
                }
                className="mt-1.5 text-sm font-medium text-brand-600 hover:underline"
              >
                + ещё услуга
              </button>
            </div>
            {hasLevels && (
              <div>
                <label className="label">Степень загрязнения</label>
                <div className="flex flex-wrap gap-2">
                  {DIRT_ORDER.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDirtLevel(d)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        dirtLevel === d
                          ? 'bg-navy-500 text-white ring-2 ring-navy-300'
                          : 'border border-navy-200 bg-white text-navy-600 hover:bg-navy-50'
                      }`}
                    >
                      {DIRT_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {isFurniture ? (
                <div>
                  <label className="label">Посадочных мест</label>
                  <input type="number" className="input" value={seats} onChange={(e) => setSeats(e.target.value)} />
                </div>
              ) : (
                <div>
                  <label className="label">Площадь, м²</label>
                  <input type="number" className="input" value={area} onChange={(e) => setArea(e.target.value)} />
                </div>
              )}
              <div>
                <label className="label">
                  Цена за {isFurniture ? 'место' : 'м²'}
                </label>
                <input
                  type="number"
                  className="input"
                  value={pricePerUnit}
                  onChange={(e) => {
                    setPricePerUnit(e.target.value);
                    setManualPrice(false);
                  }}
                  placeholder="0"
                />
              </div>
            </div>

            <div>
              <label className="label">Общая сумма</label>
              <input
                type="number"
                className="input"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setManualPrice(true);
                }}
                placeholder="0"
              />
              <div className="mt-1 flex items-center gap-2 text-xs text-navy-600">
                {manualPrice ? (
                  <>
                    <span>Сумма задана вручную</span>
                    <button
                      type="button"
                      className="text-brand-600 underline"
                      onClick={() => setManualPrice(false)}
                    >
                      вернуть расчёт
                    </button>
                  </>
                ) : (
                  <span>
                    {units > 0 && unitPrice > 0
                      ? `${units} × ${unitPrice} = ${computed} сомони`
                      : 'Укажите объём и цену — сумма посчитается сама'}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">Отмена</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            title={canSubmit ? undefined : 'Заполните ФИО и телефон правильно'}
          >
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────── Расшифровка счётчика заказов ─────────────

/**
 * Заказы клиента прямо из списка. Карточка клиента показывает то же самое,
 * но уводит со страницы — а здесь важно быстро свериться и вернуться
 * к отфильтрованному списку, не теряя место в нём.
 */
function ClientOrdersModal({
  client,
  onOpenCard,
  onClose,
}: {
  client: Client;
  onOpenCard: () => void;
  onClose: () => void;
}) {
  const { data, loading, error, reload } = useFetch<Client>(`/clients/${client.id}`, {
    deps: [client.id],
  });

  const orders = data?.orders ?? [];
  const priceOf = (o: Order) => o.finalPrice ?? o.estimatedPrice ?? 0;
  const paid = orders.filter((o) => o.stage === 'PAID');

  return (
    <DetailModal
      title={client.fullName}
      subtitle={`${formatPhone(client.phone)} · ${SOURCE_LABEL[client.source]}`}
      onClose={onClose}
    >
      {error ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DetailStats
            items={[
              { label: 'Всего заказов', value: data ? orders.length : '…' },
              { label: 'Оплачено', value: data ? paid.length : '…' },
              {
                label: 'Принёс',
                value: data ? formatPrice(paid.reduce((s, o) => s + priceOf(o), 0)) : '…',
                tone: 'success',
              },
            ]}
          />

          <DetailTable
            rows={data ? orders : null}
            loading={loading}
            rowKey={(o) => o.id}
            emptyText="У клиента ещё нет заказов"
            columns={[
              {
                key: 'date',
                header: 'Дата',
                cell: (o) => (
                  <span className="whitespace-nowrap font-medium text-navy-900">
                    {formatDate(o.createdAt)}
                  </span>
                ),
              },
              {
                key: 'what',
                header: 'Уборка',
                cell: (o) => (
                  <div>
                    <div className="text-navy-800">{TYPE_LABEL[o.cleaningType]}</div>
                    <div className="text-xs text-navy-600">
                      {o.address || 'адрес не указан'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'stage',
                header: 'Этап',
                cell: (o) => (
                  <Badge className={STAGE_COLOR[o.stage]}>{STAGE_LABEL[o.stage]}</Badge>
                ),
              },
              {
                key: 'price',
                header: 'Сумма',
                align: 'right',
                cell: (o) => (
                  <span className="font-bold text-navy-900">{formatPrice(priceOf(o))}</span>
                ),
              },
            ]}
          />

          <button onClick={onOpenCard} className="btn-ghost mt-3 w-full">
            Открыть карточку клиента
          </button>
        </>
      )}
    </DetailModal>
  );
}
