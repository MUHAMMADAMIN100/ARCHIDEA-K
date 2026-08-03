import { useEffect, useRef, useState } from 'react';
import { Bell, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { userSeesFinance } from '../types';
import { invalidateOrderRelated, useFetch } from '../api/hooks';
import { Modal, Badge, Spinner, ErrorState, EmptyState, Skeleton } from './ui';
import { useToast } from './Toast';
import { useDialog } from './Dialog';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';
import { CleanerPicker, Tabs, UserPicker } from './common';
import { NameInput, PhoneInput } from './ContactFields';
import { withRetry } from '../lib/util';
import { isValidPersonName, normalizePhone } from '../lib/contact';
import { formatDateTz, formatDateTimeTz, toDateTimeInput } from '../lib/date';
import { OrderChecklistCard } from './OrderChecklist';
import { HistoryPanel } from './HistoryPanel';
import { ReminderModal } from './ReminderModal';
import {
  TAG_COLOR,
  TAG_LABEL,
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
  ClientTag,
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

/** Статусы клиента, доступные для выбора прямо из карточки заявки */
const CLIENT_TAGS: ClientTag[] = ['VIP', 'REGULAR', 'POTENTIAL', 'REFUSED'];

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
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [tab, setTab] = useState<TabKey>('order');

  /**
   * Режим правки (ТЗ 2.1).
   *
   * На телефоне карточка открывается для ЧТЕНИЯ: её смотрят на ходу, и
   * случайное касание не должно менять сумму, дату или состав бригады.
   * Правку включает карандаш в углу.
   *
   * На компьютере (от 640 px) поля живые сразу — так было всегда, мышью
   * не промахиваются, и лишний клик только мешал бы работать.
   *
   * Ширину читаем один раз при открытии: если человек повернёт телефон,
   * переключать режим под ним посреди правки — худшее, что можно сделать.
   */
  const [editing, setEditing] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 640,
  );
  // новый заказ всегда открывается сразу редактируемым — читать там нечего
  useEffect(() => {
    if (orderId) setEditing(window.innerWidth >= 640);
  }, [orderId]);
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
  // скидка подставлена из карточки клиента, а не задана у самого заказа
  const [discountFromClient, setDiscountFromClient] = useState(false);
  // сколько клиент уже заплатил — остаток считаем от итога
  const [paidAmount, setPaidAmount] = useState('');
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
  // «От кого» пришла заявка (ТЗ 1.4)
  const [editSourceDetail, setEditSourceDetail] = useState('');
  // запасные номера клиента (ТЗ 1.1)
  const [clientExtraPhones, setClientExtraPhones] = useState<string[]>([]);
  // статус клиента — правится прямо из карточки заявки
  const [clientTags, setClientTags] = useState<ClientTag[]>([]);
  // дополнительные основные услуги (ТЗ 1.3): ключ, объём, цена за единицу
  const [addServices, setAddServices] = useState<
    { key: string; qty: string; pricePerUnit: string }[]
  >([]);
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);
  // разовые сотрудники под этот заказ: кого позвали и сколько отдали
  const [guests, setGuests] = useState<{ fullName: string; rate: string }[]>([]);
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

  /*
   * Дополнительные основные услуги (ТЗ 1.3): каждая строка — объём × цена.
   * Цена подставляется из справочника, менеджер может её поправить.
   */
  const addRows = addServices.map((r) => {
    const t = serviceOptions.find((x) => x.key === r.key);
    const qty = Math.max(0, Math.round(Number(r.qty) || 0));
    const price = Math.max(0, Math.round(Number(r.pricePerUnit) || 0));
    return {
      ...r,
      title: t?.title ?? r.key,
      unit: t?.unit ?? 'м²',
      qtyN: qty,
      priceN: price,
      total: qty * price,
    };
  });
  const addSum = addRows.reduce((sum, r) => sum + r.total, 0);

  const workSum =
    Math.round(Number(pricePerSqm) || 0) * unitsNow + addSum;
  // оплата клиента: больше итога не считаем, остаток не уходит в минус
  const paidRaw = Math.max(0, Math.round(Number(paidAmount) || 0));
  // сколько всего отдали разовым сотрудникам по этому заказу
  const guestsTotal = guests.reduce(
    (sum, g) => sum + Math.max(0, Math.round(Number(g.rate) || 0)),
    0,
  );
  const subtotalSum = workSum + extrasSum;

  /*
   * Авто-итог: пока сумму не задали руками, поле «Общая сумма» повторяет
   * расчёт целиком — работы, доп. услуги в заявке и надбавки. Один источник
   * цифры вместо трёх разрозненных пересчётов в обработчиках полей.
   */
  useEffect(() => {
    if (isManualPrice) return;
    const next = subtotalSum > 0 ? String(subtotalSum) : '';
    setFinalPrice((prev) => (prev === next ? prev : next));
  }, [subtotalSum, isManualPrice]);
  // скидка не может быть больше стоимости — так же считает сервер
  const discountSum = Math.min(
    Math.max(0, Math.round(Number(discount) || 0)),
    subtotalSum,
  );
  const toPaySum = subtotalSum - discountSum;
  // оплата не может превышать итог — остаток никогда не уходит в минус
  const paidSum = Math.min(paidRaw, toPaySum);
  const dueSum = toPaySum - paidSum;
  /*
   * Закрытый заказ: этап у него не меняется. Вернуть в работу может только
   * руководитель — на случай, если оплату отметили по ошибке. Тот же запрет
   * стоит на сервере, здесь он лишь честно показывает, что доступно.
   */
  const closedOrder = order?.stage === 'PAID';
  const canReopen = userSeesFinance(user);
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
    /*
     * Скидка: своя у заказа, а если её нет — постоянная скидка клиента.
     *
     * Раньше постоянная скидка подставлялась только при создании заказа.
     * Руководитель вписывал её в карточку клиента позже и не понимал,
     * почему в уже открытой заявке «Скидка 0»: связи между двумя цифрами
     * на экране не было видно.
     */
    if (!skip('discount')) {
      const own = o.discount ?? 0;
      const fromClient = o.client?.discount ?? 0;
      const value = own > 0 ? own : fromClient;
      setDiscount(value > 0 ? String(value) : '');
      setDiscountFromClient(own === 0 && fromClient > 0);
    }
    if (!skip('guests')) {
      setGuests(
        (o.guestCleaners ?? []).map((g) => ({
          fullName: g.fullName,
          rate: String(g.rate ?? ''),
        })),
      );
    }
    if (!skip('paidAmount')) {
      setPaidAmount(o.paidAmount ? String(o.paidAmount) : '');
    }
    if (!skip('client')) {
      setClientName(o.client?.fullName ?? '');
      setClientPhone(o.client?.phone ?? '');
      setClientExtraPhones(o.client?.extraPhones ?? []);
      setClientTags(o.client?.tags ?? []);
    }
    if (!skip('request')) {
      setEditSource(o.source);
      setEditManagerId(o.managerId ?? null);
      setEditCreatedAt(o.createdAt.slice(0, 10));
      setEditEstimated(String(o.estimatedPrice ?? ''));
      setEditPreferredDate(o.preferredDate?.slice(0, 10) ?? '');
      setEditPreferredTime(o.preferredTime ?? '');
      setEditComment(o.comment ?? '');
      setEditSourceDetail(o.sourceDetail ?? '');
    }
    if (!skip('addServices')) {
      setAddServices(
        (o.additionalServices ?? []).map((r) => ({
          key: r.key,
          qty: String(r.qty),
          pricePerUnit: String(r.pricePerUnit),
        })),
      );
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

  /*
   * Итог больше не считается здесь «объём × цена».
   *
   * Именно из-за этой формулы добавленная услуга не попадала в «Общую сумму»:
   * поле обновлялось только при смене объёма или цены за единицу, а про доп.
   * услуги и надбавки не знало вовсе. Человек добавлял услугу на 32 сомони,
   * видел в поле прежние 270 и решал, что система её не посчитала. Теперь
   * поле держит эффект ниже — по той же цифре, что стоит в итоговой панели.
   */
  const applyUnitPrice = (rawPrice: string, _units: number) => {
    setPricePerSqm(rawPrice);
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
  };

  const onSeatsChange = (v: string) => {
    markTouched('pricing');
    setEditSeats(v);
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
    // дальше поле подхватит эффект авто-итога
    setIsManualPrice(false);
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
    /*
     * Отметки «что трогали» читаем ДО onClose(): закрытие модалки обнуляет
     * orderId, эффект сбрасывает touchedRef, и к моменту, когда очередь
     * доходит до карточки клиента (после await первого запроса), флаг уже
     * стёрт — правки статуса, тегов, ФИО и телефона молча терялись.
     */
    const clientTouched = touched('client');
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
      /*
       * В карточке показываем ровно ту сумму, которую посчитает сервер:
       * работы + доп. услуги − скидка. Поле finalPrice хранит только стоимость
       * работ, и подставлять его сюда нельзя — карточка показывала бы сумму
       * без доп. услуг до первого обновления страницы.
       */
      finalPrice: isManualPrice ? (newFinalPrice ?? order.finalPrice) : toPaySum,
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
        /*
         * Итог отправляем ТОЛЬКО когда менеджер вписал сумму руками.
         *
         * Поле finalPrice в форме хранит стоимость работ: при смене площади
         * оно пересчитывается как «цена за единицу × объём». Пока оно уходило
         * на сервер безусловно, любая правка площади затирала итог этой
         * цифрой — доп. услуги и скидка из суммы исчезали. Заказ на 150 м²
         * с шестью окнами дешевел на 300 сомони от одного изменения площади.
         *
         * В остальных случаях сумму считает сервер: у него и справочник цен,
         * и доп. услуги, и скидка.
         */
        ...(isManualPrice && newFinalPrice != null
          ? { finalPrice: newFinalPrice }
          : {}),
        isManualPrice,
        preferences: trimmedPrefs,
        extras: selectedExtras,
        discount: discountSum,
        // данные заявки — правятся прямо в карточке
        source: editSource,
        sourceDetail: editSourceDetail.trim(),
        paidAmount: paidSum,
        guestCleaners: guests
          .map((g) => ({
            fullName: g.fullName.trim(),
            rate: Math.max(0, Math.round(Number(g.rate) || 0)),
          }))
          .filter((g) => g.fullName.length > 1),
        additionalServices: addRows
          .filter((r) => r.qtyN > 0)
          .map((r) => ({
            key: r.key,
            qty: r.qtyN,
            pricePerUnit: r.priceN,
          })),
        comment: editComment.trim(),
        ...(editManagerId ? { managerId: editManagerId } : {}),
        ...(editCreatedAt ? { createdAt: editCreatedAt } : {}),
        ...(editEstimated !== '' ? { estimatedPrice: toInt(editEstimated) } : {}),
        preferredDate: editPreferredDate,
        preferredTime: editPreferredTime,
      });
      // ФИО, телефон, статус и теги принадлежат клиенту, а не заказу
      if (clientTouched) {
        await api.patch(`/clients/${order.clientId}`, {
          fullName: clientName.trim(),
          phone: normalizePhone(clientPhone) ?? clientPhone,
          extraPhones: clientExtraPhones
            .map((p) => normalizePhone(p))
            .filter((p): p is string => !!p),
          tags: clientTags,
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
      /*
       * Смена этапа порождает записи в других разделах: осмотр — выезд в
       * «Сменах», оплата — черновик ведомости. Их кэш надо забыть, иначе при
       * переходе туда человек увидит прежнее состояние до фонового обновления.
       */
      invalidateOrderRelated();
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
      headerAction={
        /*
         * Карандаш включает правку — только на телефоне (ТЗ 2.1).
         *
         * Заказ там открывается для чтения: карточку смотрят на ходу, и
         * случайное касание не должно менять сумму или дату. На компьютере
         * поля живые сразу, как и были: мышью не промахиваются.
         *
         * Побочно это закрывает ТЗ 6 — в режиме чтения полей для ввода нет,
         * и клавиатуре появляться не от чего.
         */
        order && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="press rounded-lg p-1 text-brand-600 transition-colors hover:bg-brand-50 sm:hidden"
            aria-label="Изменить заказ"
            title="Изменить"
          >
            <Pencil className="h-5 w-5" />
          </button>
        ) : null
      }
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

          {/*
            Полосой напоминаем, что карточка открыта для чтения, и даём
            вторую точку входа в правку — не все ищут иконку в углу.
          */}
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="press flex w-full items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 sm:hidden"
            >
              <Pencil className="h-4 w-4" />
              Изменить заказ
            </button>
          )}

          {/*
            disabled на fieldset выключает ВСЕ вложенные поля разом — это
            штатное поведение HTML, а не приём. Перечислять полсотни инпутов
            по одному было бы и длиннее, и надёжнее забыть половину.
          */}
          <fieldset
            disabled={!editing}
            className="m-0 min-w-0 space-y-4 border-0 p-0 disabled:opacity-100"
          >

          {detailError && (
            <div className="flex animate-fade-in flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
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

          {/* вкладки переключают содержимое на месте — короткое проявление
              показывает, что сменилась именно панель, а не всё окно */}
          {tab === 'order' && (
            <div className="animate-page-in space-y-5">
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
                    <NameInput
                      label="Клиент"
                      value={clientName}
                      onChange={(v) => {
                        markTouched('client');
                        setClientName(v);
                      }}
                    />
                  </div>
                  <div>
                    <PhoneInput
                      value={clientPhone}
                      onChange={(v) => {
                        markTouched('client');
                        setClientPhone(v);
                      }}
                    />
                    {/* запасные номера (ТЗ 1.1) */}
                    {clientExtraPhones.map((p, i) => (
                      <div key={i} className="mt-2 flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <PhoneInput
                            value={p}
                            onChange={(v) => {
                              markTouched('client');
                              setClientExtraPhones((prev) =>
                                prev.map((x, j) => (j === i ? v : x)),
                              );
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            markTouched('client');
                            setClientExtraPhones((prev) =>
                              prev.filter((_, j) => j !== i),
                            );
                          }}
                          className="press mt-2 shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                          aria-label="Убрать номер"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        markTouched('client');
                        setClientExtraPhones((prev) => [...prev, '']);
                      }}
                      className="mt-1.5 text-xs font-medium text-brand-600 hover:underline"
                    >
                      + ещё номер
                    </button>
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
                    {/* «От кого» (ТЗ 1.4): рекомендатель или партнёр */}
                    <input
                      className="input mt-2"
                      value={editSourceDetail}
                      maxLength={120}
                      onChange={(e) => setEditSourceDetail(e.target.value)}
                      placeholder="От кого — например: От Анисы"
                    />
                  </div>
                  {/*
                    Статус и теги клиента. Держим их в карточке заявки, а не
                    только в карточке клиента: менеджер помечает VIP или
                    отказника по ходу разговора, не уходя из заявки.
                  */}
                  <div className="sm:col-span-2">
                    <label className="label">Статус и теги клиента</label>
                    <div className="flex flex-wrap gap-1.5">
                      {CLIENT_TAGS.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            markTouched('client');
                            setClientTags((prev) =>
                              prev.includes(t)
                                ? prev.filter((x) => x !== t)
                                : // статус у клиента один: новый заменяет прежний
                                  [t],
                            );
                          }}
                          className={`press rounded-lg px-2.5 py-1 text-xs font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-120 ease-out ${
                            clientTags.includes(t)
                              ? TAG_COLOR[t] + ' ring-1 ring-brand-300'
                              : 'border border-navy-200 bg-white text-navy-600'
                          }`}
                        >
                          {TAG_LABEL[t]}
                        </button>
                      ))}
                    </div>
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
                    <TimePicker
                      value={editPreferredTime}
                      onChange={setEditPreferredTime}
                      ariaLabel="Желаемое время клиента"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Комментарий клиента</label>
                  <textarea
                    rows={2}
                    className="input"
                    value={editComment}
                    onChange={(e) => setEditComment(e.target.value)}
                    placeholder="что написал или сказал клиент при обращении"
                  />
                </div>
              </div>

              {/* Параметры заявки (редактирование) */}
              <div className="grid gap-4 sm:grid-cols-3">
                {/* Услуга — на всю строку: длинные названия должны быть видны целиком */}
                <div className="sm:col-span-3">
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
                        className={`press rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-120 ease-out ${
                          editDirt === d
                            ? 'bg-brand-500 text-white ring-1 ring-brand-300'
                            : 'border border-navy-200 bg-white text-navy-600 hover:bg-navy-50'
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
                {/*
                  Закрытый заказ. Этап у него не меняется ни здесь, ни
                  перетаскиванием: сделка завершена, доход записан. Исключение
                  одно — руководитель, если оплату отметили по ошибке; тогда
                  доход снимается автоматически при возврате.
                */}
                {closedOrder && (
                  <p className="mb-2 text-xs text-navy-600">
                    {canReopen
                      ? 'Заказ оплачен и закрыт. Смена этапа снимет записанный доход — делайте это, только если оплату отметили по ошибке.'
                      : 'Заказ оплачен и закрыт — этап менять нельзя. Если оплату отметили по ошибке, обратитесь к руководителю.'}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {STAGE_ORDER.map((s) => {
                    /*
                     * «Оплачено / Закрыто» недоступно, пока есть недоплата:
                     * закрытый заказ уходит из воронки и попадает в выручку,
                     * и долг после этого теряется из виду.
                     */
                    const blocked =
                      (s === 'PAID' && dueSum > 0) ||
                      (closedOrder && s !== 'PAID' && !canReopen);
                    return (
                      <button
                        key={s}
                        disabled={blocked}
                        title={
                          s === 'PAID' && dueSum > 0
                            ? `Клиент должен ${formatPrice(
                                dueSum,
                              )} — внесите оплату выше`
                            : closedOrder && !canReopen
                              ? 'Заказ закрыт — вернуть его в работу может руководитель'
                              : undefined
                        }
                        onClick={() => {
                          markTouched('stage');
                          setStage(s);
                        }}
                        className={`press rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-120 ease-out ${
                          stage === s
                            ? STAGE_COLOR[s] + ' ring-1 ring-brand-300'
                            : 'bg-white text-navy-600 border border-navy-200 hover:bg-navy-50'
                        } ${blocked ? 'cursor-not-allowed opacity-40' : ''}`}
                      >
                        {STAGE_LABEL[s]}
                      </button>
                    );
                  })}
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
                      <p className="mt-1 text-xs text-navy-600">
                        {unitsNow} {unitLabel} × {pricePerSqm} ={' '}
                        {formatPrice(Math.round(Number(pricePerSqm) * unitsNow))}
                        {addSum > 0 && ` + услуги ${formatPrice(addSum)}`}
                        {extrasSum > 0 && ` + доп. ${formatPrice(extrasSum)}`}
                      </p>
                    )
                  )}
                </div>
                <div>
                  <label className="label">Дата и время уборки</label>
                  {/*
                    С sm: и выше это треть ряда — около двухсот пикселей. Дата
                    и время рядом там не помещались: на поле даты оставалось
                    семьдесят пикселей и вместо «07.08.2026» было видно «2…».
                    Поэтому в узкой колонке они идут друг под другом, а на
                    телефоне, где колонка во всю ширину, — в один ряд.
                  */}
                  <div className="flex gap-2 sm:flex-col">
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
                    <TimePicker
                      className="w-[7.5rem] shrink-0 sm:w-full"
                      value={scheduledTime}
                      onChange={(v) => {
                        markTouched('scheduledDate');
                        setScheduledTime(v);
                      }}
                      ariaLabel="Время уборки"
                    />
                  </div>
                  {order.preferredDate && (
                    <div className="mt-1 text-xs text-navy-600">
                      Заполнено по выбору клиента с сайта — можно изменить
                    </div>
                  )}
                </div>
              </div>

              {/* Несколько услуг в одной заявке (ТЗ 1.3) */}
              <div className="space-y-2 rounded-xl border border-navy-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-navy-800">
                    Ещё услуги в этой заявке
                  </span>
                  <span className="text-xs text-navy-600">
                    {addSum > 0 ? formatPrice(addSum) : 'не добавлены'}
                  </span>
                </div>
                {addRows.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-navy-100 px-2.5 py-2"
                  >
                    <select
                      className="input input-sm w-full"
                      value={r.key}
                      onChange={(e) => {
                        const key = e.target.value;
                        const t = serviceOptions.find((x) => x.key === key);
                        markTouched('addServices');
                        setAddServices((prev) =>
                          prev.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  key,
                                  pricePerUnit: String(
                                    t
                                      ? suggestUnitPrice(t, editDirt) ??
                                          t.priceMedium ??
                                          0
                                      : 0,
                                  ),
                                }
                              : x,
                          ),
                        );
                      }}
                    >
                      {serviceOptions.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      className="input input-sm w-20"
                      value={r.qty}
                      onChange={(e) => {
                        markTouched('addServices');
                        setAddServices((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, qty: e.target.value } : x,
                          ),
                        );
                      }}
                      aria-label="Объём"
                    />
                    <span className="text-xs font-medium text-navy-700">
                      {r.unit} ×
                    </span>
                    <input
                      type="number"
                      min={0}
                      className="input input-sm w-20"
                      value={r.pricePerUnit}
                      onChange={(e) => {
                        markTouched('addServices');
                        setAddServices((prev) =>
                          prev.map((x, j) =>
                            j === i
                              ? { ...x, pricePerUnit: e.target.value }
                              : x,
                          ),
                        );
                      }}
                      aria-label="Цена за единицу"
                    />
                    <span className="min-w-[5.5rem] text-right text-sm font-medium tabular-nums text-navy-800">
                      {formatPrice(r.total)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        markTouched('addServices');
                        setAddServices((prev) =>
                          prev.filter((_, j) => j !== i),
                        );
                      }}
                      className="press shrink-0 rounded-lg p-1 text-navy-600 hover:bg-red-50 hover:text-red-600"
                      aria-label="Убрать услугу"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    markTouched('addServices');
                    const first = serviceOptions.find(
                      (t) => t.key !== serviceKey,
                    );
                    setAddServices((prev) => [
                      ...prev,
                      {
                        key: first?.key ?? serviceKey,
                        qty: '1',
                        pricePerUnit: String(
                          first
                            ? suggestUnitPrice(first, editDirt) ??
                                first.priceMedium ??
                                0
                            : 0,
                        ),
                      },
                    ]);
                  }}
                  className="text-sm font-medium text-brand-600 hover:underline"
                >
                  + ещё услуга
                </button>
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
                  <span className="text-xs text-navy-600">
                    {extrasSum > 0 ? formatPrice(extrasSum) : 'не выбраны'}
                  </span>
                </div>

                {extrasCatalogue.length === 0 ? (
                  <p className="text-xs text-navy-600">
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
                          <span className="shrink-0 text-xs text-navy-600">
                            {formatPrice(e.price)}
                            {e.hasQty ? ' / шт' : ''}
                          </span>
                          {/* количество — только там, где цена умножается */}
                          {on && e.hasQty && (
                            <input
                              type="number"
                              min={1}
                              className="input input-sm w-20 shrink-0"
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
                        setDiscountFromClient(false);
                        setDiscount(ev.target.value);
                      }}
                      placeholder="0"
                    />
                    {discountFromClient && (
                      <p className="mt-1 text-xs text-navy-600">
                        Постоянная скидка клиента — можно изменить
                      </p>
                    )}

                    {/*
                      Сколько клиент уже заплатил. Из итога вычитается и
                      показывается остаток — это учёт долга по заказу; в книгу
                      доходов сумма попадает один раз, при переводе заказа
                      в «Оплачено / Закрыто».
                    */}
                    <label className="label mt-3">Оплатил клиент, сомони</label>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={paidAmount}
                      onChange={(ev) => {
                        markTouched('paidAmount');
                        setPaidAmount(ev.target.value);
                      }}
                      placeholder="0"
                    />
                  </div>
                  {/* Итог: видно, из чего он сложился, сколько вычли и сколько ещё должны */}
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
                      <div className="flex justify-between font-medium text-red-700">
                        <span>Скидка</span>
                        <span className="tabular-nums">− {formatPrice(discountSum)}</span>
                      </div>
                    )}
                    <div className="mt-1 flex justify-between border-t border-navy-200 pt-1 font-bold text-navy-900">
                      <span>К оплате</span>
                      <span className="tabular-nums">{formatPrice(toPaySum)}</span>
                    </div>
                    {paidSum > 0 && (
                      <div className="flex justify-between font-medium text-emerald-700">
                        <span>Оплачено</span>
                        <span className="tabular-nums">
                          − {formatPrice(paidSum)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`mt-1 flex justify-between border-t border-navy-200 pt-1 font-bold ${
                        dueSum > 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      <span>{dueSum > 0 ? 'Остаток' : 'Оплачен полностью'}</span>
                      <span className="tabular-nums">{formatPrice(dueSum)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Предпочтения клиента (ТЗ 10.2) */}
              <div className="space-y-2">
                {clientPreferences && (
                  <div className="rounded-xl border border-navy-100 bg-navy-50/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-navy-600">
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
                  <p className="mt-1 text-xs text-navy-600">
                    Если текст изменится — уведомление о предпочтениях уйдёт в рабочий чат Telegram.
                  </p>
                </div>
              </div>

              {/* Команда */}
              {/*
                Разовые сотрудники под заказ (ТЗ): кого позвали на один раз и
                сколько отдали на руки. В штат и в выплаты не попадают —
                это запись о наличных, чтобы сумма не терялась.
              */}
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="label !mb-0">
                    Разовые сотрудники (на один раз)
                  </label>
                  {guestsTotal > 0 && (
                    <span className="text-xs font-semibold text-navy-700">
                      Отдано: {formatPrice(guestsTotal)}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {guests.map((g, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input
                        className="input input-sm min-w-[9rem] flex-1"
                        value={g.fullName}
                        maxLength={120}
                        placeholder="Имя разового сотрудника"
                        onChange={(e) => {
                          markTouched('guests');
                          setGuests((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, fullName: e.target.value } : x,
                            ),
                          );
                        }}
                      />
                      <input
                        type="number"
                        min={0}
                        className="input input-sm w-32"
                        value={g.rate}
                        placeholder="Сколько дали"
                        aria-label="Сколько отдали, сомони"
                        onChange={(e) => {
                          markTouched('guests');
                          setGuests((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, rate: e.target.value } : x,
                            ),
                          );
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          markTouched('guests');
                          setGuests((prev) => prev.filter((_, j) => j !== i));
                        }}
                        className="press shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                        aria-label="Убрать разового сотрудника"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {/* кнопка, а не ссылка: рядом с полями её было не отличить */}
                  <button
                    type="button"
                    onClick={() => {
                      markTouched('guests');
                      setGuests((prev) => [...prev, { fullName: '', rate: '' }]);
                    }}
                    className="press flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-navy-300 py-2 text-sm font-semibold text-brand-600 transition-[background-color,border-color,transform] duration-120 ease-out hover:border-brand-500 hover:bg-navy-50"
                  >
                    <span className="text-lg leading-none">+</span>
                    разовый сотрудник
                  </button>
                </div>
              </div>

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
                <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}
            </div>
          )}

          {tab === 'work' && (
            <div className="animate-page-in space-y-4">
              <Info label="Ответственный менеджер" value={order.manager?.fullName ?? 'не назначен'} />
              <ShiftGroupsSection groups={order.shiftGroups} loadFailed={detailError} />
            </div>
          )}

          {/*
            canEdit=true: доступ к чек-листу совпадает с доступом к самому
            заказу (OrderChecklistController использует ту же проверку, что
            и getOne) — раз карточка открылась, значит и правка разрешена.
          */}
          {tab === 'checklist' && (
            <div className="animate-page-in">
              <OrderChecklistCard orderId={order.id} canEdit />
            </div>
          )}

          {tab === 'history' && (
            <div className="animate-page-in">
              <HistoryPanel entity="ORDER" entityId={order.id} />
            </div>
          )}

          </fieldset>

          {/*
            Низ карточки. На телефоне «Отмена» и «Сохранить» — двумя равными
            кнопками во всю ширину, удаление отдельной строкой ниже: раньше
            все три стояли вперемешку и промахнуться по «Удалить» было легко.

            В режиме чтения сохранять и удалять нечего — остаётся «Закрыть».
          */}
          <div className="space-y-2 border-t border-navy-100 pt-4 sm:flex sm:flex-row-reverse sm:items-center sm:justify-between sm:space-y-0">
            <div className={`gap-2 sm:flex ${editing ? 'grid grid-cols-2' : 'grid'}`}>
              <button onClick={onClose} className="btn-ghost justify-center">
                {editing ? 'Отмена' : 'Закрыть'}
              </button>
              {editing && (
                <button onClick={save} className="btn-primary justify-center">
                  Сохранить
                </button>
              )}
            </div>
            {editing && (
              <button
                onClick={remove}
                className="press inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-[background-color,border-color,transform] duration-120 ease-out hover:bg-red-50 sm:w-auto"
              >
                <Trash2 className="h-4 w-4" />
                Удалить заказ
              </button>
            )}
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
      // высота заглушки повторяет карточку выезда — когда данные придут,
      // содержимое встанет на то же место, а не прыгнет сверху вниз
      <div className="space-y-3" role="status" aria-label="Загрузка">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-md" />
        ))}
      </div>
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
        <div key={g.id} className="rounded-xl border border-navy-100 bg-white p-4 shadow-card">
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-600">
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
            <div className="mt-2 text-xs font-medium text-emerald-700">
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
      <div className="text-xs text-navy-600">{label}</div>
      <div className="font-medium text-navy-800">{value}</div>
    </div>
  );
}
