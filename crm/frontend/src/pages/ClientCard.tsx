import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, PhoneCall, Plus, Repeat2, Save, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { invalidateOrderRelated, useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { userSeesAll } from '../types';
import { Spinner, PageHeader, Badge, Modal, ErrorState } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { OrderModal } from '../components/OrderModal';
import { LabelPicker } from '../components/LabelPicker';
import { HistoryPanel } from '../components/HistoryPanel';
import { ReminderModal } from '../components/ReminderModal';
import { CleanerPicker, Tabs } from '../components/common';
import {
  TAG_LABEL,
  TAG_COLOR,
  SOURCE_LABEL,
  STAGE_LABEL,
  STAGE_COLOR,
  cleaningTypeForKey,
  TYPE_LABEL,
  ACTIVE_TYPES,
  DIRT_LABEL,
  DIRT_ORDER,
  formatPrice,
  orderDue,
  orderTotal,
  formatDate,
  formatVolume,
} from '../lib/labels';
import { formatPhone } from '../lib/contact';
import { tempId, nowISO, withRetry } from '../lib/util';
import type {
  Cleaner,
  CleaningType,
  Client,
  ClientTag,
  DirtLevel,
  Manager,
  Order,
  Tariffs,
} from '../types';

const ALL_TAGS: ClientTag[] = ['VIP', 'REGULAR', 'POTENTIAL', 'REFUSED'];

type CardTab = 'orders' | 'history';

export function ClientCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const { data, loading, error, reload, setData } = useFetch<Client>(
    `/clients/${id}`,
    { deps: [id] },
  );
  const { data: cleaners } = useFetch<Cleaner[]>('/cleaners?activeOnly=true');

  const [notes, setNotes] = useState<string | null>(null);
  const [tags, setTags] = useState<ClientTag[] | null>(null);
  // свободные теги (ТЗ 1.2) — редактируются вместе со статусом
  const [labels, setLabels] = useState<string[] | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [preferences, setPreferences] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [tab, setTab] = useState<CardTab>('orders');

  if (error && !data) return <ErrorState onRetry={reload} />;
  if (loading || !data) return <Spinner />;

  const curNotes = notes ?? data.notes ?? '';
  const curTags = tags ?? data.tags;
  const curLabels = labels ?? data.labels ?? [];
  const curPreferences = preferences ?? data.preferences ?? '';

  /*
   * Статус клиента ОДИН. Раньше теги включались независимо, и клиент мог
   * оказаться одновременно VIP, «Постоянным» и «Отказником» — статус
   * переставал что-либо значить. Выбор заменяет прежний, повторный клик
   * снимает статус совсем.
   */
  const toggleTag = (t: ClientTag) =>
    setTags((prev) => {
      const base = prev ?? data.tags;
      return base.includes(t) ? [] : [t];
    });

  // оптимистично: правки заказа отражаются в истории сразу
  const patchOrder = (orderId: string, patch: Partial<Order>) => {
    setData((c) =>
      c
        ? {
            ...c,
            orders: (c.orders ?? []).map((o) =>
              o.id === orderId ? { ...o, ...patch } : o,
            ),
          }
        : c,
    );
  };

  // оптимистично: новый заказ появляется в истории сразу
  const createOrder = (payload: {
    cleaningType: CleaningType;
    serviceKey?: string;
    additionalServices?: { key: string; qty: number }[];
    dirtLevel?: DirtLevel;
    area: number;
    seats?: number;
    estimatedPrice: number;
    managerId?: string;
    cleanerIds?: string[];
  }) => {
    if (!data) return;
    const id = tempId();
    const assignedCleaners = (payload.cleanerIds ?? [])
      .map((cid) => (cleaners ?? []).find((c) => c.id === cid))
      .filter((c): c is Cleaner => !!c)
      .map((c) => ({ id: c.id, fullName: c.fullName }));
    const optimistic: Order = {
      id,
      clientId: data.id,
      managerId: payload.managerId,
      stage: 'NEW',
      source: 'CALL',
      cleaningType: payload.cleaningType,
      dirtLevel: payload.dirtLevel ?? null,
      area: payload.area,
      seats: payload.seats ?? null,
      estimatedPrice: payload.estimatedPrice,
      finalPrice: null,
      isLarge: payload.estimatedPrice >= 2000,
      createdAt: nowISO(),
      cleaners: assignedCleaners,
    };
    setData((c) =>
      c ? { ...c, orders: [optimistic, ...(c.orders ?? [])] } : c,
    );
    api
      .post('/orders', { clientId: data.id, source: 'CALL', ...payload })
      .then(() => {
        // воронка должна показать новый заказ сразу при переходе, без обновления
        invalidateOrderRelated();
        reload();
      })
      .catch((e) => {
        toast.error(e?.response?.data?.message || 'Не удалось создать заказ');
        setData((c) =>
          c ? { ...c, orders: (c.orders ?? []).filter((o) => o.id !== id) } : c,
        );
      });
  };

  /*
   * Одна кнопка на всё: предпочтения, статус и заметки уходят одним запросом.
   * Раньше кнопок «Сохранить» было две (у предпочтений и у заметок), и
   * человек не понимал, какая из них что сохраняет.
   */
  const saveMeta = async () => {
    const nextNotes = curNotes;
    const nextTags = curTags;
    const nextLabels = curLabels;
    const nextPrefs = curPreferences.trim() || null;
    // оптимистично применяем изменения сразу
    setData((c) =>
      c
        ? {
            ...c,
            notes: nextNotes,
            tags: nextTags,
            labels: nextLabels,
            preferences: nextPrefs,
          }
        : c,
    );
    setNotes(null);
    setTags(null);
    setLabels(null);
    setPreferences(null);
    setSavingMeta(true);
    try {
      await api.patch(`/clients/${id}`, {
        notes: nextNotes,
        tags: nextTags,
        labels: nextLabels,
        preferences: nextPrefs,
      });
      toast.success('Сохранено');
    } catch {
      toast.error('Не удалось сохранить — изменения отменены');
      reload();
    } finally {
      setSavingMeta(false);
    }
  };

  // ТЗ 10.2 — постоянные предпочтения клиента (переносятся в форму заказа)
  const savePreferences = async () => {
    const next = curPreferences.trim() || null;
    setData((c) => (c ? { ...c, preferences: next } : c));
    setPreferences(null);
    setSavingPrefs(true);
    try {
      await api.patch(`/clients/${id}`, { preferences: next });
      toast.success('Предпочтения сохранены');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить — изменения отменены');
      reload();
    } finally {
      setSavingPrefs(false);
    }
  };

  const removeClient = async () => {
    if (!data) return;
    const ordersCount = data.orders?.length ?? 0;
    const ok = await dialog.confirm({
      title: 'Удалить клиента?',
      message:
        `Клиент «${data.fullName}» будет перемещён в корзину` +
        (ordersCount > 0 ? ` вместе со всеми его заказами (${ordersCount})` : '') +
        '. Восстановить его можно в разделе «Корзина» в течение 90 дней.',
      confirmText: 'В корзину',
      danger: true,
    });
    if (!ok) return;
    // оптимистично: сразу уходим к списку, удаление — в фоне
    // (список сам подтянет актуальные данные тихим рефетчем)
    toast.success('Клиент перемещён в корзину');
    navigate('/clients');
    withRetry(() => api.delete(`/clients/${data.id}`)).catch((e: any) => {
      toast.error(e?.response?.data?.message || 'Не удалось удалить клиента');
    });
  };

  return (
    <div>
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
      >
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>

      <PageHeader
        title={data.fullName}
        subtitle={SOURCE_LABEL[data.source] + ' · клиент'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <a href={`tel:${formatPhone(data.phone)}`} className="btn-primary">
              <Phone className="h-4 w-4" />
              {formatPhone(data.phone)}
            </a>
            <button onClick={() => setShowReminder(true)} className="btn-ghost">
              <PhoneCall className="h-4 w-4" />
              Напомнить позвонить
            </button>
            <button
              onClick={removeClient}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Удалить
            </button>
          </div>
        }
      />

      {/* ТЗ 9.4 — метка «повторный клиент» заметна сразу, а не спрятана в таблице */}
      {(data.isRepeat || (data.paidOrdersCount ?? 0) > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {data.isRepeat && (
            <Badge className="bg-teal-100 text-teal-700">
              <Repeat2 className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />
              Повторный клиент
            </Badge>
          )}
          {(data.paidOrdersCount ?? 0) > 0 && (
            <Badge className="bg-emerald-100 text-emerald-700">
              Оплачено заказов: {data.paidOrdersCount}
            </Badge>
          )}
          {data.lastOrderAt && (
            <span className="text-xs text-navy-600">
              Последний заказ: {formatDate(data.lastOrderAt)}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Левая колонка — инфо + предпочтения + теги + заметки */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="mb-3 font-bold text-navy-900">Информация</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Телефон" value={formatPhone(data.phone)} />
              {(data.extraPhones ?? []).length > 0 && (
                <Row
                  label="Доп. номера"
                  value={(data.extraPhones ?? [])
                    .map((p) => formatPhone(p))
                    .join(', ')}
                />
              )}
              <Row label="Источник" value={SOURCE_LABEL[data.source]} />
              {data.sourceDetail && (
                <Row label="От кого" value={data.sourceDetail} />
              )}
              <Row label="Менеджер" value={data.manager?.fullName ?? '—'} />
              <Row label="Последний контакт" value={formatDate(data.lastContactAt)} />
              <Row label="Всего заказов" value={String(data.orders?.length ?? 0)} />
            </dl>
          </div>

          <div className="card p-5">
            <h3 className="font-bold text-navy-900">Предпочтения клиента</h3>
            <p className="mb-3 mt-0.5 text-xs text-navy-600">
              Что важно учитывать при каждой уборке — видно менеджеру при оформлении нового заказа
            </p>
            <textarea
              className="input min-h-[90px] resize-none"
              value={curPreferences}
              onChange={(e) => setPreferences(e.target.value)}
              placeholder="Например: не трогать документы на столе, есть домашние животные"
            />
          </div>

          <div className="card p-5">
            <h3 className="mb-3 font-bold text-navy-900">Статус клиента</h3>
            <div className="flex flex-wrap gap-2">
              {ALL_TAGS.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    curTags.includes(t)
                      ? TAG_COLOR[t] + ' ring-2 ring-navy-200'
                      : 'border border-navy-200 bg-white text-navy-600'
                  }`}
                >
                  {TAG_LABEL[t]}
                </button>
              ))}
            </div>

            {/* Теги выбираются кнопками из общего списка, а не печатаются */}
            <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-navy-600">
              Теги
            </h4>
            <LabelPicker value={curLabels} onChange={setLabels} />
            <p className="mt-2 text-xs text-navy-600">
              Сохраняются кнопкой «Сохранить…» ниже.
            </p>
          </div>

          <div className="card p-5">
            <h3 className="mb-3 font-bold text-navy-900">Заметки менеджера</h3>
            <textarea
              className="input min-h-[100px] resize-none"
              value={curNotes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Комментарии о клиенте…"
            />
            <button
              onClick={saveMeta}
              disabled={savingMeta}
              className="btn-primary mt-3 w-full"
            >
              <Save className="h-4 w-4" />
              {savingMeta
                ? 'Сохранение…'
                : 'Сохранить предпочтения, статус и заметки'}
            </button>
          </div>
        </div>

        {/* Правая колонка — заказы и история изменений */}
        <div className="lg:col-span-2">
          <div className="card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <Tabs
                items={[
                  { value: 'orders', label: 'История заказов' },
                  { value: 'history', label: 'История изменений' },
                ]}
                value={tab}
                onChange={setTab}
              />
              {tab === 'orders' && (
                <button onClick={() => setShowAddOrder(true)} className="btn-ghost">
                  <Plus className="h-4 w-4" />
                  Новый заказ
                </button>
              )}
            </div>

            {tab === 'orders' ? (
              <div className="space-y-3">
                {(data.orders ?? []).map((o) => (
                  <button
                    key={o.id}
                    // временный (оптимистичный) заказ ещё не создан на сервере — не открываем
                    disabled={o.id.startsWith('temp_')}
                    onClick={() => {
                      if (!o.id.startsWith('temp_')) setOpenOrder(o);
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-navy-100 p-4 text-left hover:bg-navy-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-navy-900">
                          {TYPE_LABEL[o.cleaningType]}
                        </span>
                        <Badge className={STAGE_COLOR[o.stage]}>
                          {STAGE_LABEL[o.stage]}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-navy-600">
                        {formatVolume(o)}
                        {o.dirtLevel && ` · ${DIRT_LABEL[o.dirtLevel]}`} ·{' '}
                        {formatDate(o.createdAt)}
                        {o.rejectionReason && ` · Отказ: ${o.rejectionReason}`}
                      </div>
                    </div>
                    <div className="text-right">
                      {/*
                        История покупок клиента: сумма заказа целиком —
                        столько он у нас купил. Остаток долга (если платил
                        частями) идёт отдельной строкой.
                      */}
                      <div className="font-bold text-navy-800">
                        {formatPrice(orderTotal(o))}
                      </div>
                      {(o.paidAmount ?? 0) > 0 && orderDue(o) > 0 && (
                        <div className="text-xs font-semibold text-red-700">
                          долг {orderDue(o).toLocaleString('ru-RU')}
                        </div>
                      )}
                      {o.cleaners && o.cleaners.length > 0 && (
                        <div className="text-xs text-navy-600">
                          👥 {o.cleaners.map((c) => c.fullName).join(', ')}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
                {(!data.orders || data.orders.length === 0) && (
                  <div className="py-8 text-center text-sm text-navy-600">
                    Заказов пока нет — здесь появится вся история покупок клиента
                  </div>
                )}
              </div>
            ) : (
              <HistoryPanel entity="CLIENT" entityId={data.id} />
            )}
          </div>
        </div>
      </div>

      <OrderModal
        orderId={openOrder?.id ?? null}
        initial={openOrder ?? undefined}
        onClose={() => setOpenOrder(null)}
        onUpdated={reload}
        onOptimistic={patchOrder}
        onDeleted={(oid) =>
          setData((c) =>
            c ? { ...c, orders: (c.orders ?? []).filter((o) => o.id !== oid) } : c,
          )
        }
      />
      {showAddOrder && (
        <AddOrderModal
          isDirector={userSeesAll(user)}
          cleaners={cleaners ?? []}
          onClose={() => setShowAddOrder(false)}
          onCreate={createOrder}
        />
      )}
      <ReminderModal
        open={showReminder}
        onClose={() => setShowReminder(false)}
        clientId={data.id}
        clientName={data.fullName}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-navy-600">{label}</dt>
      <dd className="font-medium text-navy-800">{value}</dd>
    </div>
  );
}

function AddOrderModal({
  isDirector,
  cleaners,
  onClose,
  onCreate,
}: {
  isDirector: boolean;
  cleaners: Cleaner[];
  onClose: () => void;
  onCreate: (payload: {
    cleaningType: CleaningType;
    serviceKey?: string;
    additionalServices?: { key: string; qty: number }[];
    dirtLevel?: DirtLevel;
    area: number;
    seats?: number;
    estimatedPrice: number;
    /** ТЗ 5 — цена за единицу и итог */
    pricePerSqm?: number;
    finalPrice?: number;
    managerId?: string;
    cleanerIds?: string[];
  }) => void;
}) {
  const [serviceKey, setServiceKey] = useState('GENERAL');
  const [dirtLevel, setDirtLevel] = useState<DirtLevel>('LIGHT');
  const [area, setArea] = useState('');
  const [seats, setSeats] = useState('');
  const [estimatedPrice, setEstimatedPrice] = useState('');
  // ТЗ 5: цена за единицу и автоматический расчёт суммы
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [manualPrice, setManualPrice] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [cleanerIds, setCleanerIds] = useState<string[]>([]);
  // ещё услуги в заявке (ТЗ 1.3)
  const [moreServices, setMoreServices] = useState<
    { key: string; qty: string }[]
  >([]);
  const { data: managers } = useFetch<Manager[]>(
    isDirector ? '/users/managers' : null,
  );
  const { data: tariffs } = useFetch<Tariffs>('/tariffs');
  // список услуг — из справочника: своя услуга директора тоже должна быть здесь
  const serviceOptions = (tariffs?.tariffs ?? []).filter(
    (t) => t.isActive !== false,
  );
  const tariff = serviceOptions.find((t) => t.key === serviceKey);
  const isFurniture = tariff
    ? tariff.unit !== 'м²'
    : serviceKey === 'FURNITURE';
  const hasLevels = tariff ? tariff.hasLevels : serviceKey !== 'FURNITURE';

  // цена за единицу подставляется из услуги по степени загрязнения
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
      pricePerUnit: price || 0,
      qtyN: qty,
      total: qty * (price || 0),
    };
  });
  const moreSum = moreRows.reduce((sum, r) => sum + r.total, 0);
  const computed = units * unitPrice + moreSum;

  useEffect(() => {
    if (!manualPrice) setEstimatedPrice(computed ? String(computed) : '');
  }, [computed, manualPrice]);

  const submit = () => {
    const toInt = (s: string) => Math.round(Number(s)) || 0; // бэкенд принимает только целые
    onCreate({
      cleaningType: cleaningTypeForKey(serviceKey),
      serviceKey,
      additionalServices: moreRows
        .filter((r) => r.qtyN > 0)
        .map((r) => ({ key: r.key, qty: r.qtyN })),
      dirtLevel: hasLevels ? dirtLevel : undefined,
      area: isFurniture ? 0 : toInt(area),
      seats: isFurniture ? toInt(seats) : undefined,
      estimatedPrice: toInt(estimatedPrice),
      pricePerSqm: unitPrice || undefined,
      /*
       * Итог НЕ отправляем: его считает сервер — только он знает про
       * постоянную скидку клиента. Своя цифра из формы съедала скидку и
       * помечала заказ «задан вручную», после чего он переставал
       * пересчитываться вовсе.
       */
      managerId: managerId || undefined,
      cleanerIds: cleanerIds.length > 0 ? cleanerIds : undefined,
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Новый заказ" wide>
      <div className="space-y-3">
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
                className="input input-sm w-full"
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
                className="input input-sm w-20"
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
              <span className="shrink-0 text-xs font-medium text-navy-700">
                {r.unit} × {r.pricePerUnit.toLocaleString('ru-RU')}
              </span>
              <span className="min-w-0 flex-1 text-right text-xs font-semibold tabular-nums text-navy-800">
                {r.total > 0 ? formatPrice(r.total) : '—'}
              </span>
              <button
                type="button"
                onClick={() =>
                  setMoreServices((prev) => prev.filter((_, j) => j !== i))
                }
                className="shrink-0 rounded-lg p-1 text-navy-600 hover:text-red-600"
                aria-label="Убрать услугу"
              >
                ×
              </button>
              </div>
            </div>
          ))}
          {/* Крупная кнопка по центру вместо теряющейся ссылки */}
          <button
            type="button"
            title="Добавить ещё одну услугу в эту заявку"
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
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-navy-300 py-2 text-sm font-semibold text-brand-600 transition hover:border-brand-500 hover:bg-navy-50"
          >
            <span className="text-lg leading-none">+</span>
            ещё услуга
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
            <label className="label">Цена за {isFurniture ? 'место' : 'м²'}</label>
            <input
              type="number"
              className="input"
              value={pricePerUnit}
              onChange={(e) => {
                setPricePerUnit(e.target.value);
                setManualPrice(false);
              }}
            />
          </div>
        </div>

        <div>
          <label className="label">Общая сумма</label>
          <input
            type="number"
            className="input"
            value={estimatedPrice}
            onChange={(e) => {
              setEstimatedPrice(e.target.value);
              setManualPrice(true);
            }}
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
                {units > 0 && unitPrice > 0 ? (
                  /* расчёт по строкам: видно, из чего сложился итог */
                  <span className="block">
                    <span className="block">
                      {isFurniture ? 'Мест' : 'Площадь'}: {units} × {unitPrice} ={' '}
                      {units * unitPrice} сомони
                    </span>
                    {moreRows
                      .filter((r) => r.qtyN > 0)
                      .map((r, i) => (
                        <span key={i} className="block">
                          {r.title}: {r.qtyN} × {r.pricePerUnit} = {r.total} сомони
                        </span>
                      ))}
                    {moreSum > 0 && (
                      <span className="block font-semibold text-navy-800">
                        Итого: {units * unitPrice} + {moreSum} = {computed} сомони
                      </span>
                    )}
                  </span>
                ) : (
                  'Укажите объём и цену — сумма посчитается сама'
                )}
              </span>
            )}
          </div>
        </div>
        {isDirector && (
          <div>
            <label className="label">Менеджер</label>
            <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">— не назначен —</option>
              {(managers ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.fullName}</option>
              ))}
            </select>
          </div>
        )}

        {/* Бригаду можно назначить сразу при оформлении — не нужно повторно
            открывать заказ, чтобы добавить исполнителей (баг 3.1) */}
        <div>
          <label className="label">Команда (по желанию)</label>
          {cleaners.length === 0 ? (
            <p className="text-xs text-navy-600">Нет активных клинеров — назначьте позже, в карточке заказа</p>
          ) : (
            <CleanerPicker value={cleanerIds} onChange={setCleanerIds} />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">Отмена</button>
          <button onClick={submit} className="btn-primary">
            Создать заказ
          </button>
        </div>
      </div>
    </Modal>
  );
}
