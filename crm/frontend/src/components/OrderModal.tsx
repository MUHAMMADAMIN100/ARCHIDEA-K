import { useEffect, useRef, useState } from 'react';
import { Bell, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { Modal, Badge, Spinner, ErrorState, EmptyState } from './ui';
import { useToast } from './Toast';
import { useDialog } from './Dialog';
import { DatePicker } from './DatePicker';
import { CleanerPicker, Tabs, UserPicker } from './common';
import { NameInput, PhoneInput } from './ContactFields';
import { withRetry } from '../lib/util';
import { isValidPersonName, normalizePhone } from '../lib/contact';
import { formatDateTz, formatDateTimeTz, toDateTimeInput } from '../lib/date';
import { OrderChecklistCard } from './OrderChecklist';
import { HistoryPanel } from './HistoryPanel';
import { ReminderModal } from './ReminderModal';
import {
  STAGE_LABEL,
  STAGE_ORDER,
  STAGE_COLOR,
  TYPE_LABEL,
  SOURCE_LABEL,
  SOURCE_ORDER,
  DIRT_LABEL,
  DIRT_ORDER,
  SHIFT_GROUP_STATUS_LABEL,
  SHIFT_GROUP_STATUS_COLOR,
  formatPrice,
  formatDate,
} from '../lib/labels';
import type {
  Cleaner,
  CleaningType,
  DirtLevel,
  FunnelStage,
  LeadSource,
  Order,
  ShiftGroupBrief,
  Tariff,
  Tariffs as TariffsData,
} from '../types';

interface Props {
  orderId: string | null;
  /** Данные заказа из списка/доски — для мгновенного открытия без ожидания */
  initial?: Order;
  onClose: () => void;
  onUpdated: () => void;
  /** Оптимистичное обновление доски до ответа сервера */
  onOptimistic?: (orderId: string, patch: Partial<Order>) => void;
  /** Оптимистичное удаление заказа из списка */
  onDeleted?: (orderId: string) => void;
}

type TabKey = 'order' | 'work' | 'checklist' | 'history';

const TAB_ITEMS: { value: TabKey; label: string }[] = [
  { value: 'order', label: 'Заявка' },
  { value: 'work', label: 'Кто работал' },
  { value: 'checklist', label: 'Чек-лист' },
  { value: 'history', label: 'История' },
];

/** Все значения enum'а — старые заказы (MAINTENANCE) должны и дальше сохраняться корректно */
const CLEANING_TYPE_VALUES: CleaningType[] = [
  'MAINTENANCE',
  'GENERAL',
  'POST_RENOVATION',
  'FURNITURE',
];

/**
 * Order.cleaningType остаётся жёстким enum'ом на бэкенде (ТЗ 1.1: калькулятор
 * лендинга и старая аналитика завязаны на нём), а услуга, заведённая
 * директором, может иметь произвольный ключ. Для custom-услуги подставляем
 * GENERAL — реальная услуга при этом определяется полем serviceKey, оно
 * приоритетнее (см. orders.service.ts create()).
 */
function cleaningTypeFor(key: string): CleaningType {
  return (CLEANING_TYPE_VALUES as string[]).includes(key)
    ? (key as CleaningType)
    : 'GENERAL';
}

/** Цена за единицу из услуги по степени загрязнения — то же правило, что и в order-pricing.ts на бэкенде */
function suggestUnitPrice(
  tariff: Tariff | undefined,
  dirt: DirtLevel | '',
): number | null {
  if (!tariff) return null;
  if (!tariff.hasLevels) return tariff.priceMedium || tariff.pricePerSqm || null;
  if (dirt === 'LIGHT') return tariff.priceLight || tariff.priceMedium || null;
  if (dirt === 'HEAVY') return tariff.priceHeavy || tariff.priceMedium || null;
  return tariff.priceMedium || tariff.pricePerSqm || null;
}

export function OrderModal({
  orderId,
  initial,
  onClose,
  onUpdated,
  onOptimistic,
  onDeleted,
}: Props) {
  const toast = useToast();
  const dialog = useDialog();
  const [order, setOrder] = useState<Order | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [tab, setTab] = useState<TabKey>('order');
  const [showReminder, setShowReminder] = useState(false);

  const [stage, setStage] = useState<FunnelStage>('NEW');
  const [rejectionReason, setRejectionReason] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  // время уборки хранится в той же дате; отдельным полем, чтобы его
  // не терять при сохранении — раньше от даты оставался только день
  const [scheduledTime, setScheduledTime] = useState('');

  /*
   * Дата уборки уходит на сервер вместе со временем, если оно указано.
   * Время трактуется как местное (Душанбе) — так же, как его вводит человек.
   */
  const scheduledWithTime = scheduledDate
    ? scheduledTime
      ? `${scheduledDate}T${scheduledTime}`
      : scheduledDate
    : '';
  const [serviceKey, setServiceKey] = useState('');
  const [editDirt, setEditDirt] = useState<DirtLevel | ''>('');
  const [editArea, setEditArea] = useState('');
  const [editSeats, setEditSeats] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [pricePerSqm, setPricePerSqm] = useState('');
  const [finalPrice, setFinalPrice] = useState('');
  const [isManualPrice, setIsManualPrice] = useState(false);
  const [preferences, setPreferences] = useState('');
  // доп. услуги: ключ → количество; скидка в сомони
  const [selectedExtras, setSelectedExtras] = useState<Record<string, number>>({});
  const [discount, setDiscount] = useState('');
  // данные заявки: раньше блок был только для чтения
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [editSource, setEditSource] = useState<LeadSource>('CALL');
  const [editManagerId, setEditManagerId] = useState<string | null>(null);
  const [editCreatedAt, setEditCreatedAt] = useState('');
  const [editEstimated, setEditEstimated] = useState('');
  const [editPreferredDate, setEditPreferredDate] = useState('');
  const [editPreferredTime, setEditPreferredTime] = useState('');
  const [editComment, setEditComment] = useState('');
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);
  const [error, setError] = useState('');

  // какой заказ открыт сейчас — чтобы поздний ответ уже закрытой/сменённой
  // модалки не перезаписал состояние (гонка при быстром переключении карточек)
  const currentOrderIdRef = useRef<string | null>(null);
  /**
   * Что из полей пользователь уже трогал руками в ЭТОЙ сессии редактирования.
   * Пока поле не тронуто — оно продолжает пересеваться из авторитетного
   * ответа сервера (детальный GET); как только тронуто — сервер его больше
   * не перезаписывает, иначе правка терялась бы молча (диагноз бага 3.1, п.2 ТЗ).
   * Группа 'pricing' покрывает услугу/загрязнение/площадь-места/цену за
   * единицу/итог — они пересчитываются вместе, поэтому и гейтятся одним ключом.
   */
  const touchedRef = useRef<Set<string>>(new Set());
  const touched = (f: string) => touchedRef.current.has(f);
  const markTouched = (f: string) => touchedRef.current.add(f);

  // список услуг — источник цены за единицу (ТЗ 5) и справочник для выбора услуги
  const tariffsQuery = useFetch<TariffsData>('/tariffs');
  const activeTariffs = tariffsQuery.data?.tariffs ?? [];
  const currentKey = serviceKey || order?.serviceKey || order?.cleaningType || '';
  // старый/скрытый ключ услуги (например MAINTENANCE) — его нет среди активных,
  // но заказ на неё уже оформлен, и выбор должен остаться в селекте
  const legacyTariff: Tariff | null =
    order && currentKey && !activeTariffs.some((t) => t.key === currentKey)
      ? {
          id: 'legacy',
          key: currentKey,
          title: TYPE_LABEL[order.cleaningType] ?? currentKey,
          pricePerSqm: order.pricePerSqm ?? 0,
          priceLight: 0,
          priceMedium: order.pricePerSqm ?? 0,
          priceHeavy: 0,
          hasLevels: order.cleaningType !== 'FURNITURE',
          unit: order.cleaningType === 'FURNITURE' ? 'место' : 'м²',
          isSystem: true,
        }
      : null;
  const serviceOptions = legacyTariff ? [legacyTariff, ...activeTariffs] : activeTariffs;
  const selectedTariff = serviceOptions.find((t) => t.key === serviceKey);
  const isSeatsUnit = selectedTariff ? selectedTariff.unit !== 'м²' : serviceKey === 'FURNITURE';
  const hasLevelsNow = selectedTariff ? selectedTariff.hasLevels : serviceKey !== 'FURNITURE';

  /*
   * Расчёт для показа повторяет серверный (order-pricing.ts): работы +
   * доп. услуги − скидка. Считаем и здесь, чтобы менеджер видел итог сразу,
   * не дожидаясь ответа сервера; авторитетным остаётся сервер.
   */
  const extrasCatalogue = tariffsQuery.data?.extras ?? [];
  const extrasSum = Object.entries(selectedExtras).reduce((sum, [key, qty]) => {
    const item = extrasCatalogue.find((e) => e.key === key);
    if (!item) return sum;
    const n = Math.max(0, Math.round(Number(qty) || 0));
    if (n === 0) return sum;
    return sum + (item.hasQty ? item.price * n : item.price);
  }, 0);

  const unitLabel = selectedTariff?.unit ?? (isSeatsUnit ? 'место' : 'м²');
  const unitsNow = Number((isSeatsUnit ? editSeats : editArea) || 0);

  const workSum = Math.round(Number(pricePerSqm) || 0) * unitsNow;
  const subtotalSum = workSum + extrasSum;
  // скидка не может быть больше стоимости — так же считает сервер
  const discountSum = Math.min(
    Math.max(0, Math.round(Number(discount) || 0)),
    subtotalSum,
  );
  const toPaySum = subtotalSum - discountSum;
  // постоянные предпочтения клиента — вынесены в переменную, чтобы TS не
  // требовал повторного optional chaining внутри вложенного колбэка кнопки
  const clientPreferences = order?.client?.preferences ?? '';

  // для оптимистичного патча доски нужны имена клинеров, а не только id;
  // берём и свежий список, и то, что уже было в заказе (клинер мог быть
  // уволен, но всё ещё числиться в команде — тогда используем его прежнее имя)
  const { data: cleanersList } = useFetch<Cleaner[]>('/cleaners?activeOnly=true');
  const resolveCleanerName = (id: string): { id: string; fullName: string } | undefined =>
    cleanersList?.find((c) => c.id === id) ?? order?.cleaners?.find((c) => c.id === id);

  /** Пересевает редактируемые поля из авторитетных данных заказа, уважая touchedRef */
  const seedFields = (o: Order, opts: { force?: boolean } = {}) => {
    const skip = (f: string) => !opts.force && touched(f);
    if (!skip('stage')) {
      setStage(o.stage);
      setRejectionReason(o.rejectionReason ?? '');
    }
    if (!skip('address')) setEditAddress(o.address ?? '');
    if (!skip('scheduledDate')) {
      setScheduledDate(o.scheduledDate?.slice(0, 10) ?? '');
      setScheduledTime(o.scheduledDate ? toDateTimeInput(o.scheduledDate).slice(11, 16) : '');
    }
    if (!skip('pricing')) {
      setServiceKey(o.serviceKey ?? o.cleaningType);
      setEditDirt(o.dirtLevel ?? '');
      setEditArea(String(o.area ?? ''));
      setEditSeats(o.seats != null ? String(o.seats) : '');
      setPricePerSqm(o.pricePerSqm != null ? String(o.pricePerSqm) : '');
      setFinalPrice(o.finalPrice != null ? String(o.finalPrice) : '');
      setIsManualPrice(!!o.isManualPrice);
    }
    if (!skip('preferences')) setPreferences(o.preferences ?? '');
    if (!skip('extras')) setSelectedExtras(o.extras ?? {});
    if (!skip('discount')) setDiscount(o.discount ? String(o.discount) : '');
    if (!skip('client')) {
      setClientName(o.client?.fullName ?? '');
      setClientPhone(o.client?.phone ?? '');
    }
    if (!skip('request')) {
      setEditSource(o.source);
      setEditManagerId(o.managerId ?? null);
      setEditCreatedAt(o.createdAt.slice(0, 10));
      setEditEstimated(String(o.estimatedPrice ?? ''));
      setEditPreferredDate(o.preferredDate?.slice(0, 10) ?? '');
      setEditPreferredTime(o.preferredTime ?? '');
      setEditComment(o.comment ?? '');
    }
    if (!skip('cleaners')) setSelectedCleaners((o.cleaners ?? []).map((c) => c.id));
  };

  /** Раздельная загрузка деталей заказа — своя ошибка и кнопка «Повторить» (диагноз бага 3.1, п.2 ТЗ) */
  const loadDetail = (id: string) => {
    setDetailError(false);
    api
      .get<Order>(`/orders/${id}`)
      .then((res) => {
        if (currentOrderIdRef.current !== id) return; // заказ в модалке уже сменился
        setOrder(res.data);
        seedFields(res.data);
      })
      .catch(() => {
        if (currentOrderIdRef.current !== id) return;
        setDetailError(true);
      });
  };

  useEffect(() => {
    currentOrderIdRef.current = orderId;
    setTab('order');
    setShowReminder(false);
    setError('');
    touchedRef.current = new Set();

    if (!orderId) {
      setOrder(null);
      return;
    }

    setDetailError(false);
    if (initial) {
      // мгновенно показываем то, что уже знаем из списка/доски
      setOrder(initial);
      seedFields(initial, { force: true });
    } else {
      setOrder(null);
    }
    loadDetail(orderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // ── Расчёт суммы (ТЗ 5): единица × цена за единицу = итог, пока итог не задан вручную ──

  const applyUnitPrice = (rawPrice: string, units: number) => {
    setPricePerSqm(rawPrice);
    if (!isManualPrice) {
      const p = Number(rawPrice || 0);
      setFinalPrice(units > 0 && p >= 0 ? String(Math.round(p * units)) : '');
    }
  };

  const onServiceChange = (key: string) => {
    markTouched('pricing');
    setServiceKey(key);
    const tariff = serviceOptions.find((t) => t.key === key);
    const nextHasLevels = tariff ? tariff.hasLevels : key !== 'FURNITURE';
    const nextDirt: DirtLevel | '' = nextHasLevels ? editDirt || 'MEDIUM' : '';
    setEditDirt(nextDirt);
    const nextIsSeats = tariff ? tariff.unit !== 'м²' : key === 'FURNITURE';
    const units = Number((nextIsSeats ? editSeats : editArea) || 0);
    const suggested = suggestUnitPrice(tariff, nextDirt);
    if (suggested != null) applyUnitPrice(String(suggested), units);
  };

  const onDirtChange = (d: DirtLevel) => {
    markTouched('pricing');
    setEditDirt(d);
    const suggested = suggestUnitPrice(selectedTariff, d);
    if (suggested != null) applyUnitPrice(String(suggested), unitsNow);
  };

  const onAreaChange = (v: string) => {
    markTouched('pricing');
    setEditArea(v);
    if (!isSeatsUnit && !isManualPrice) {
      const units = Number(v || 0);
      const p = Number(pricePerSqm || 0);
      setFinalPrice(units > 0 && p >= 0 ? String(Math.round(p * units)) : '');
    }
  };

  const onSeatsChange = (v: string) => {
    markTouched('pricing');
    setEditSeats(v);
    if (isSeatsUnit && !isManualPrice) {
      const units = Number(v || 0);
      const p = Number(pricePerSqm || 0);
      setFinalPrice(units > 0 && p >= 0 ? String(Math.round(p * units)) : '');
    }
  };

  const onPricePerSqmChange = (v: string) => {
    markTouched('pricing');
    applyUnitPrice(v, unitsNow);
  };

  const onFinalPriceChange = (v: string) => {
    markTouched('pricing');
    setFinalPrice(v);
    setIsManualPrice(true);
  };

  const resetToComputed = () => {
    markTouched('pricing');
    setIsManualPrice(false);
    const p = Number(pricePerSqm || 0);
    setFinalPrice(unitsNow > 0 && p >= 0 ? String(Math.round(p * unitsNow)) : '');
  };

  // ── Сохранение ──

  const cleanersChanged = () => {
    if (!order) return false;
    const before = new Set((order.cleaners ?? []).map((c) => c.id));
    const now = new Set(selectedCleaners);
    if (before.size !== now.size) return true;
    for (const id of now) if (!before.has(id)) return true;
    return false;
  };

  const save = async () => {
    if (!order) return;
    if (stage === 'REJECTED' && !rejectionReason.trim()) {
      setError('Укажите причину отказа');
      return;
    }
    /*
     * Контакты клиента проверяем теми же правилами, что и в базе клиентов:
     * имя без цифр, телефон ровно из девяти цифр. Иначе через карточку заказа
     * можно было бы завести то, что форма клиента не пропускает.
     */
    if (touched('client')) {
      if (!isValidPersonName(clientName)) {
        setError('Имя клиента: только буквы, без цифр');
        return;
      }
      if (!normalizePhone(clientPhone)) {
        setError('Телефон клиента: ровно 9 цифр');
        return;
      }
    }
    setError('');

    const toInt = (s: string) => Math.round(Number(s)); // бэкенд принимает только целые
    const newArea = editArea !== '' ? toInt(editArea) : order.area;
    const newSeats = isSeatsUnit
      ? editSeats !== ''
        ? toInt(editSeats)
        : (order.seats ?? 0)
      : (order.seats ?? null);
    const newPricePerSqm = pricePerSqm !== '' ? toInt(pricePerSqm) : null;
    const newFinalPrice = finalPrice !== '' ? toInt(finalPrice) : null;
    const newDirt = hasLevelsNow ? editDirt || null : null;
    const trimmedPrefs = preferences.trim();
    const cleanersTouched = touched('cleaners');
    // PATCH /orders/:id/cleaners уходит ТОЛЬКО если команду реально трогали —
    // иначе он безусловно перезаписывал бы назначенную бригаду пустым/чужим
    // набором (диагноз бага 3.1, пп.3-4 ТЗ)
    const cleanersChangedFlag = cleanersTouched && cleanersChanged();

    // 1) Оптимистично обновляем карточку/доску и закрываем окно — без ожидания
    const patch: Partial<Order> = {
      stage,
      cleaningType: cleaningTypeFor(serviceKey || order.cleaningType),
      serviceKey: serviceKey || order.serviceKey,
      dirtLevel: newDirt,
      area: newArea,
      seats: newSeats,
      pricePerSqm: newPricePerSqm ?? order.pricePerSqm,
      finalPrice: newFinalPrice ?? order.finalPrice,
      isManualPrice,
      preferences: trimmedPrefs || null,
      address: editAddress || order.address,
      scheduledDate: scheduledWithTime || order.scheduledDate,
      rejectionReason: stage === 'REJECTED' ? rejectionReason : order.rejectionReason,
    };
    // cleaners подмешиваем в патч, только если реально трогали — иначе в кэш
    // доски попал бы пустой/неполный массив при незагруженном списке клинеров
    if (cleanersTouched) {
      patch.cleaners = selectedCleaners
        .map(resolveCleanerName)
        .filter((x): x is { id: string; fullName: string } => !!x);
    }
    onOptimistic?.(order.id, patch);
    onClose();

    // 2) Запросы уходят в фоне; при ошибке — откат через reload + тост
    try {
      await api.patch(`/orders/${order.id}`, {
        cleaningType: cleaningTypeFor(serviceKey || order.cleaningType),
        serviceKey: serviceKey || undefined,
        dirtLevel: newDirt,
        area: newArea,
        ...(isSeatsUnit ? { seats: newSeats ?? 0 } : {}),
        address: editAddress || undefined,
        ...(newPricePerSqm != null ? { pricePerSqm: newPricePerSqm } : {}),
        ...(newFinalPrice != null ? { finalPrice: newFinalPrice } : {}),
        isManualPrice,
        preferences: trimmedPrefs,
        extras: selectedExtras,
        discount: discountSum,
        // данные заявки — правятся прямо в карточке
        source: editSource,
        comment: editComment.trim(),
        ...(editManagerId ? { managerId: editManagerId } : {}),
        ...(editCreatedAt ? { createdAt: editCreatedAt } : {}),
        ...(editEstimated !== '' ? { estimatedPrice: toInt(editEstimated) } : {}),
        preferredDate: editPreferredDate,
        preferredTime: editPreferredTime,
      });
      // ФИО и телефон принадлежат клиенту, а не заказу
      if (touched('client')) {
        await api.patch(`/clients/${order.clientId}`, {
          fullName: clientName.trim(),
          phone: normalizePhone(clientPhone) ?? clientPhone,
        });
      }
      if (cleanersChangedFlag) {
        await api.patch(`/orders/${order.id}/cleaners`, {
          cleanerIds: selectedCleaners,
        });
      }
      if (stage !== order.stage || stage === 'REJECTED') {
        await api.patch(`/orders/${order.id}/stage`, {
          stage,
          rejectionReason: stage === 'REJECTED' ? rejectionReason : undefined,
          scheduledDate: scheduledWithTime || undefined,
        });
      } else if (scheduledWithTime) {
        await api.patch(`/orders/${order.id}`, { scheduledDate: scheduledWithTime });
      }
      onUpdated();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить заказ');
      onUpdated(); // откат к серверному состоянию
    }
  };

  /** Удаление переносит заказ в корзину, а не стирает его безвозвратно (ТЗ 6) */
  const remove = async () => {
    if (!order) return;
    const ok = await dialog.confirm({
      title: 'Удалить заказ?',
      message:
        'Заказ будет перемещён в корзину. Его можно восстановить в разделе «Корзина» в течение 90 дней.',
      confirmText: 'В корзину',
      danger: true,
    });
    if (!ok) return;
    onDeleted?.(order.id);
    onClose();
    try {
      await withRetry(() => api.delete(`/orders/${order.id}`));
      onUpdated();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить заказ');
      onUpdated();
    }
  };

  /** CleanerPicker отдаёт целиком новый набор id — не «переключение одного» */
  const handleCleanersChange = (ids: string[]) => {
    markTouched('cleaners');
    setSelectedCleaners(ids);
  };

  return (
    <Modal
      open={!!orderId}
      onClose={onClose}
      title={order ? `Заказ — ${order.client?.fullName ?? ''}` : 'Заказ'}
      wide
    >
      {!order ? (
        detailError ? (
          <ErrorState
            text="Не удалось загрузить заказ. Проверьте интернет."
            onRetry={() => orderId && loadDetail(orderId)}
          />
        ) : (
          <Spinner />
        )
      ) : (
        <div className="space-y-4">
          <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} />

          {detailError && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <span>Не удалось обновить данные заказа с сервера — показаны последние известные.</span>
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 text-xs"
                onClick={() => loadDetail(order.id)}
              >
                Повторить
              </button>
            </div>
          )}

          {tab === 'order' && (
            <div className="space-y-5">
              {/*
                Данные заявки. Раньше блок был только для чтения, и опечатку
                в имени или телефоне приходилось править в базе клиентов, а
                источник и время обращения — вообще нигде. Теперь правится
                прямо здесь: ФИО и телефон уходят в карточку клиента, остальное
                в заказ.
              */}
              <div className="space-y-3 rounded-xl bg-navy-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Клиент</label>
                    <NameInput
                      value={clientName}
                      onChange={(v) => {
                        markTouched('client');
                        setClientName(v);
                      }}
                    />
                  </div>
                  <div>
                    <label className="label">Телефон</label>
                    <PhoneInput
                      value={clientPhone}
                      onChange={(v) => {
                        markTouched('client');
                        setClientPhone(v);
                      }}
                    />
                  </div>
                  <div>
                    <label className="label">Источник</label>
                    <select
                      className="input"
                      value={editSource}
                      onChange={(e) => setEditSource(e.target.value as LeadSource)}
                    >
                      {SOURCE_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {SOURCE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Ответственный менеджер</label>
                    <UserPicker
                      value={editManagerId}
                      onChange={(v) => setEditManagerId(v)}
                      placeholder="не назначен"
                    />
                  </div>
                  <div>
                    <label className="label">Оформлена</label>
                    <DatePicker value={editCreatedAt} onChange={setEditCreatedAt} />
                  </div>
                  <div>
                    <label className="label">Расчёт с сайта, сомони</label>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={editEstimated}
                      onChange={(e) => setEditEstimated(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Клиент просил — дата</label>
                    <DatePicker
                      clearable
                      value={editPreferredDate}
                      onChange={setEditPreferredDate}
                      placeholder="не указана"
                    />
                  </div>
                  <div>
                    <label className="label">Клиент просил — время</label>
                    <input
                      type="time"
                      className="input h-11"
                      value={editPreferredTime}
                      onChange={(e) => setEditPreferredTime(e.target.value)}
                      aria-label="Желаемое время клиента"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Комментарий с сайта</label>
                  <textarea
                    rows={2}
                    className="input"
                    value={editComment}
                    onChange={(e) => setEditComment(e.target.value)}
                    placeholder="что написал клиент при обращении"
                  />
                </div>
              </div>

              {/* Параметры заявки (редактирование) */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="label">Услуга</label>
                  {tariffsQuery.error && !tariffsQuery.data ? (
                    <button
                      type="button"
                      className="btn-ghost w-full justify-start text-sm"
                      onClick={tariffsQuery.reload}
                    >
                      Не удалось загрузить услуги — повторить
                    </button>
                  ) : (
                    <select
                      className="input"
                      value={serviceKey}
                      onChange={(e) => onServiceChange(e.target.value)}
                    >
                      {serviceOptions.length === 0 && <option value={serviceKey}>Загрузка…</option>}
                      {serviceOptions.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {isSeatsUnit ? (
                  <div>
                    <label className="label">Количество ({unitLabel})</label>
                    <input
                      type="number"
                      className="input"
                      value={editSeats}
                      onChange={(e) => onSeatsChange(e.target.value)}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="label">Площадь, {unitLabel}</label>
                    <input
                      type="number"
                      className="input"
                      value={editArea}
                      onChange={(e) => onAreaChange(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className="label">Адрес</label>
                  <input
                    className="input"
                    value={editAddress}
                    onChange={(e) => {
                      markTouched('address');
                      setEditAddress(e.target.value);
                    }}
                    placeholder="Адрес объекта"
                  />
                </div>
              </div>

              {/* Степень загрязнения (для услуг с уровнями) */}
              {hasLevelsNow && (
                <div>
                  <label className="label">Степень загрязнения</label>
                  <div className="flex flex-wrap gap-2">
                    {DIRT_ORDER.map((d) => (
                      <button
                        key={d}
                        onClick={() => onDirtChange(d)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          editDirt === d
                            ? 'bg-navy-500 text-white ring-2 ring-navy-300'
                            : 'border border-navy-200 bg-white text-navy-500 hover:bg-navy-50'
                        }`}
                      >
                        {DIRT_LABEL[d]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Текущий этап */}
              <div>
                <label className="label">Этап воронки</label>
                <div className="flex flex-wrap gap-2">
                  {STAGE_ORDER.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        markTouched('stage');
                        setStage(s);
                      }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        stage === s
                          ? STAGE_COLOR[s] + ' ring-2 ring-navy-300'
                          : 'bg-white text-navy-500 border border-navy-200 hover:bg-navy-50'
                      }`}
                    >
                      {STAGE_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>

              {stage === 'REJECTED' && (
                <div>
                  <label className="label">Причина отказа *</label>
                  <input
                    className="input"
                    value={rejectionReason}
                    onChange={(e) => {
                      markTouched('stage');
                      setRejectionReason(e.target.value);
                    }}
                    placeholder="Например: дорого, выбрали другую компанию"
                  />
                </div>
              )}

              {/* Расчёт суммы (ТЗ 5) */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="label">Цена за {unitLabel}</label>
                  <input
                    type="number"
                    className="input"
                    value={pricePerSqm}
                    onChange={(e) => onPricePerSqmChange(e.target.value)}
                    placeholder="сомони"
                  />
                </div>
                <div>
                  <label className="label">Общая сумма</label>
                  <input
                    type="number"
                    className="input"
                    value={finalPrice}
                    onChange={(e) => onFinalPriceChange(e.target.value)}
                    placeholder={String(order.estimatedPrice)}
                  />
                  {isManualPrice ? (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-600">
                      <span>Сумма задана вручную</span>
                      <button
                        type="button"
                        onClick={resetToComputed}
                        className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Вернуть расчёт
                      </button>
                    </div>
                  ) : (
                    pricePerSqm !== '' &&
                    unitsNow > 0 && (
                      <p className="mt-1 text-xs text-navy-400">
                        {unitsNow} {unitLabel} × {pricePerSqm} ={' '}
                        {formatPrice(Math.round(Number(pricePerSqm) * unitsNow))}
                      </p>
                    )
                  )}
                </div>
                <div>
                  <label className="label">Дата и время уборки</label>
                  {/* узкая колонка: короткая подпись, чтобы дата и время встали в один ряд */}
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <DatePicker
                        placeholder="дд.мм.гггг"
                        value={scheduledDate}
                        onChange={(v) => {
                          markTouched('scheduledDate');
                          setScheduledDate(v);
                        }}
                      />
                    </div>
                    <input
                      type="time"
                      className="input h-11 w-[7.5rem] shrink-0"
                      value={scheduledTime}
                      onChange={(e) => {
                        markTouched('scheduledDate');
                        setScheduledTime(e.target.value);
                      }}
                      aria-label="Время уборки"
                    />
                  </div>
                  {order.preferredDate && (
                    <div className="mt-1 text-xs text-navy-400">
                      Заполнено по выбору клиента с сайта — можно изменить
                    </div>
                  )}
                </div>
              </div>

              {/*
                Дополнительные услуги и скидка.
                Раньше доп. услуги можно было выбрать только на сайте, а в CRM
                их не было видно и в сумму они не входили — заказ считался
                неверно. Скидка не вводилась вообще.
              */}
              <div className="space-y-3 rounded-xl border border-navy-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-navy-800">
                    Дополнительные услуги
                  </span>
                  <span className="text-xs text-navy-400">
                    {extrasSum > 0 ? formatPrice(extrasSum) : 'не выбраны'}
                  </span>
                </div>

                {extrasCatalogue.length === 0 ? (
                  <p className="text-xs text-navy-400">
                    Справочник доп. услуг пуст — заведите их в разделе «Услуги и цены».
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {extrasCatalogue.map((e) => {
                      const qty = selectedExtras[e.key] ?? 0;
                      const on = qty > 0;
                      return (
                        <div
                          key={e.key}
                          className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 ${
                            on ? 'border-brand-400 bg-brand-50/60' : 'border-navy-100'
                          }`}
                        >
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(ev) => {
                                markTouched('extras');
                                setSelectedExtras((prev) => {
                                  const next = { ...prev };
                                  if (ev.target.checked) next[e.key] = 1;
                                  else delete next[e.key];
                                  return next;
                                });
                              }}
                              className="h-4 w-4 shrink-0 accent-navy-500"
                            />
                            <span className="min-w-0 truncate text-sm text-navy-800">
                              {e.title}
                            </span>
                          </label>
                          <span className="shrink-0 text-xs text-navy-500">
                            {formatPrice(e.price)}
                            {e.hasQty ? ' / шт' : ''}
                          </span>
                          {/* количество — только там, где цена умножается */}
                          {on && e.hasQty && (
                            <input
                              type="number"
                              min={1}
                              className="input h-9 w-20 shrink-0"
                              value={qty}
                              onChange={(ev) => {
                                markTouched('extras');
                                const n = Math.max(1, Math.round(Number(ev.target.value) || 1));
                                setSelectedExtras((prev) => ({ ...prev, [e.key]: n }));
                              }}
                              aria-label={`Количество: ${e.title}`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Скидка, сомони</label>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={discount}
                      onChange={(ev) => {
                        markTouched('discount');
                        setDiscount(ev.target.value);
                      }}
                      placeholder="0"
                    />
                  </div>
                  {/* Итог: видно, из чего он сложился и сколько вычли */}
                  <div className="rounded-xl bg-navy-50 px-3 py-2 text-sm">
                    <div className="flex justify-between text-navy-600">
                      <span>Работы</span>
                      <span className="tabular-nums">{formatPrice(workSum)}</span>
                    </div>
                    {extrasSum > 0 && (
                      <div className="flex justify-between text-navy-600">
                        <span>Доп. услуги</span>
                        <span className="tabular-nums">{formatPrice(extrasSum)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-navy-600">
                      <span>Основная стоимость</span>
                      <span className="tabular-nums">{formatPrice(subtotalSum)}</span>
                    </div>
                    {discountSum > 0 && (
                      <div className="flex justify-between font-medium text-red-600">
                        <span>Скидка</span>
                        <span className="tabular-nums">− {formatPrice(discountSum)}</span>
                      </div>
                    )}
                    <div className="mt-1 flex justify-between border-t border-navy-200 pt-1 font-bold text-navy-900">
                      <span>К оплате</span>
                      <span className="tabular-nums">{formatPrice(toPaySum)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Предпочтения клиента (ТЗ 10.2) */}
              <div className="space-y-2">
                {clientPreferences && (
                  <div className="rounded-xl border border-navy-100 bg-navy-50/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-navy-400">
                        Постоянные предпочтения клиента
                      </div>
                      <button
                        type="button"
                        className="text-xs font-medium text-brand-600 hover:underline"
                        onClick={() => {
                          markTouched('preferences');
                          setPreferences(clientPreferences);
                        }}
                      >
                        Скопировать в заказ
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-navy-700">{clientPreferences}</p>
                  </div>
                )}
                <div>
                  <label className="label">Предпочтения / описание для этого заказа</label>
                  <textarea
                    className="input min-h-[70px] resize-none"
                    value={preferences}
                    onChange={(e) => {
                      markTouched('preferences');
                      setPreferences(e.target.value);
                    }}
                    maxLength={2000}
                    placeholder="Например: аллергия на хлор, есть кот, ключи у консьержа, просит эко-средства…"
                  />
                  <p className="mt-1 text-xs text-navy-400">
                    Если текст изменится — уведомление о предпочтениях уйдёт в рабочий чат Telegram.
                  </p>
                </div>
              </div>

              {/* Команда */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="label !mb-0">Назначить команду (клинеры)</label>
                  <button
                    type="button"
                    onClick={() => setShowReminder(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    Напомнить позвонить
                  </button>
                </div>
                <CleanerPicker value={selectedCleaners} onChange={handleCleanersChange} />
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}
            </div>
          )}

          {tab === 'work' && (
            <div className="space-y-4">
              <Info label="Ответственный менеджер" value={order.manager?.fullName ?? 'не назначен'} />
              <ShiftGroupsSection groups={order.shiftGroups} loadFailed={detailError} />
            </div>
          )}

          {/*
            canEdit=true: доступ к чек-листу совпадает с доступом к самому
            заказу (OrderChecklistController использует ту же проверку, что
            и getOne) — раз карточка открылась, значит и правка разрешена.
          */}
          {tab === 'checklist' && <OrderChecklistCard orderId={order.id} canEdit />}

          {tab === 'history' && <HistoryPanel entity="ORDER" entityId={order.id} />}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy-100 pt-4">
            <button
              onClick={remove}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Удалить заказ
            </button>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">
                Отмена
              </button>
              <button onClick={save} className="btn-primary">
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {order && (
        <ReminderModal
          open={showReminder}
          clientId={order.clientId}
          clientName={order.client?.fullName}
          orderId={order.id}
          onClose={() => setShowReminder(false)}
        />
      )}
    </Modal>
  );
}

/** Блок «Кто работал» (ТЗ 3.2) — только чтение, данные из выездов по заказу */
function ShiftGroupsSection({
  groups,
  loadFailed,
}: {
  groups?: ShiftGroupBrief[];
  /** Детальный GET уже провалился — не крутим спиннер вечно, а даём понятный текст */
  loadFailed?: boolean;
}) {
  if (groups === undefined) {
    return loadFailed ? (
      <EmptyState text="Не удалось загрузить данные о выездах. Нажмите «Повторить» вверху карточки." />
    ) : (
      <Spinner />
    );
  }
  if (groups.length === 0) {
    return (
      <EmptyState text="Выездов по заказу пока не было. Как только бригада выедет на объект и выезд свяжут с этим заказом в разделе «Смены», здесь появится, кто и когда работал." />
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id} className="rounded-xl border border-navy-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-navy-900">
              {formatDateTz(g.date)}
              {g.startTime ? ` · ${g.startTime}${g.endTime ? `–${g.endTime}` : ''}` : ''}
            </div>
            <Badge className={SHIFT_GROUP_STATUS_COLOR[g.status]}>
              {SHIFT_GROUP_STATUS_LABEL[g.status]}
            </Badge>
          </div>
          <div className="mt-1 text-sm text-navy-600">{g.address}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-500">
            {g.brigadeName && <span>Бригада: {g.brigadeName}</span>}
            {g.brigadierName && <span>Бригадир: {g.brigadierName}</span>}
            {g.managerName && <span>Менеджер выезда: {g.managerName}</span>}
          </div>
          {g.members.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.members.map((m) => (
                <span
                  key={m.id}
                  className="rounded-lg border border-navy-100 bg-navy-50 px-2 py-1 text-xs text-navy-700"
                >
                  {m.fullName}
                  {m.role && m.role !== 'Клинер' ? ` · ${m.role}` : ''}
                </span>
              ))}
            </div>
          )}
          {g.closedAt && (
            <div className="mt-2 text-xs font-medium text-emerald-600">
              Смена закрыта {formatDateTimeTz(g.closedAt)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-xs text-navy-400">{label}</div>
      <div className="font-medium text-navy-800">{value}</div>
    </div>
  );
}
