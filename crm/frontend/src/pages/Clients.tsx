import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Download, Repeat2, Trash2, X } from 'lucide-react';
import { api } from '../api/client';
import { useFetch, mutateCache } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Badge, Modal, ErrorState } from '../components/ui';
import { useToast } from '../components/Toast';
import {
  Column,
  DataTable,
  FilterReset,
  PeriodFilter,
  SearchInput,
  type Period,
} from '../components/common';
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
import { tempId, nowISO, isTempId } from '../lib/util';
import { isValidPhone } from '../lib/contact';
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
  /** Адрес объекта — тот же, что записан в карточке клиента */
  address?: string;
  /** Свои доп. услуги строками — как в карточке заказа; в счёт идут отмеченные */
  customExtras?: { title: string; price: number; checked: boolean }[];
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

  /*
   * Период базы клиентов — всё время по умолчанию: список клиентов это
   * справочник, а не отчёт, и обрезать его молча нельзя. Фильтр нужен,
   * чтобы посмотреть «кто пришёл за неделю/месяц».
   */
  const [period, setPeriod] = useState<Period>({ from: '', to: '' });

  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (tag) query.set('tag', tag);
  if (source) query.set('source', source);
  query.set('sort', sort);
  if (ordersFilter === 'repeat') query.set('repeat', 'true');
  // период — по дате появления клиента в базе
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);

  const { data, loading, error, reload, setData } = useFetch<Client[]>(
    `/clients?${query.toString()}`,
    {
      deps: [search, tag, source, sort, ordersFilter, period.from, period.to],
      pollMs: 15000,
    },
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
      sourceDetail?: string;
      address?: string;
      tags?: ClientTag[];
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
      tags: payload.tags ?? [],
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
      /*
       * На телефоне строка карточки — «подпись слева, значение справа».
       * Имя прижимаем вправо вместе с телефоном: раньше оно оставалось у
       * левого края, рядом с подписью «КЛИЕНТ», а номер под ним уходил
       * вправо — и две части одного значения расходились по разным краям.
       */
      render: (c) => (
        <div>
          <div className="flex items-center justify-end gap-1.5 font-semibold text-navy-900 md:justify-start">
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
      title: 'Статус',
      hideOnMobile: true,
      render: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.tags.length === 0 ? (
            <span className="text-navy-600">—</span>
          ) : (
            c.tags.map((t) => (
              <Badge key={t} className={TAG_COLOR[t]}>
                {TAG_LABEL[t]}
              </Badge>
            ))
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
              <span className="ml-1 text-xs text-emerald-700">
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
    <div className="animate-page-in">
      <PageHeader
        title="База клиентов"
        /*
         * На телефоне кнопки — значки рядом с заголовком: с подписями они
         * занимали отдельную строку и отодвигали фильтры и сам список вниз.
         * На компьютере подписи остаются.
         */
        action={
          <div className="flex gap-2">
            <button
              onClick={exportCsv}
              className="btn-ghost h-10 w-10 p-0 sm:h-auto sm:w-auto sm:px-3.5 sm:py-2"
              aria-label="Экспорт в CSV"
              title="Экспорт в CSV"
            >
              <Download className="h-5 w-5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Экспорт</span>
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="btn-primary h-10 w-10 p-0 sm:h-auto sm:w-auto sm:px-3.5 sm:py-2"
              aria-label="Добавить клиента"
              title="Добавить клиента"
            >
              <Plus className="h-5 w-5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Добавить</span>
            </button>
          </div>
        }
      />

      {/* Фильтры */}
      {/*
        Фильтры. На телефоне четыре селекта встают сеткой два на два —
        одинаковой ширины, в два ряда; поиск занимает строку целиком.
        Раньше они шли колонкой разной длины и занимали пол-экрана.
      */}
      <div className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <div className="col-span-2 sm:min-w-[200px] sm:flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по имени или телефону" />
        </div>
        <div className="col-span-2 sm:flex-none">
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        <select className="input w-full sm:w-[180px] sm:flex-none" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Все статусы</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>{TAG_LABEL[t]}</option>
          ))}
        </select>
        <select className="input w-full sm:w-[180px] sm:flex-none" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Все источники</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
          ))}
        </select>
        <select className="input w-full sm:w-[180px] sm:flex-none" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="recent">Сначала недавние</option>
          <option value="name">По имени</option>
        </select>
        <select
          className="input w-full sm:w-[180px] sm:flex-none"
          value={ordersFilter}
          onChange={(e) => setOrdersFilter(e.target.value as OrdersFilter)}
        >
          <option value="all">Все клиенты</option>
          <option value="repeat">Только повторные</option>
          <option value="none">Без заказов</option>
        </select>
        <FilterReset
          className="col-span-2 justify-center sm:col-auto"
          show={!!search || !!tag || !!source || sort !== 'recent' || ordersFilter !== 'all'}
          onReset={() => {
            setSearch('');
            setTag('');
            setSource('');
            setSort('recent');
            setOrdersFilter('all');
          }}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={loading}
        error={error}
        onRetry={reload}
        /*
         * Клиент, только что созданный, до ответа сервера живёт под
         * временным номером. Переход по нему открывал карточку, которой на
         * сервере ещё нет, и человек видел «Не удалось загрузить данные».
         */
        onRowClick={(c) => {
          if (isTempId(c.id)) {
            toast.success('Клиент ещё сохраняется — откройте через секунду');
            return;
          }
          navigate(`/clients/${c.id}`);
        }}
        perPage={15}
        emptyText="Клиенты не найдены — измените фильтры или добавьте нового клиента"
      />

      {showAdd && (
        <AddClientModal
          onClose={() => setShowAdd(false)}
          onCreate={createClient}
          isDirector={userSeesAll(user)}
        />
      )}

      {ordersFor && (
        <ClientOrdersModal
          client={ordersFor}
          onOpenCard={() => {
            if (isTempId(ordersFor.id)) return;
            navigate(`/clients/${ordersFor.id}`);
          }}
          onClose={() => setOrdersFor(null)}
        />
      )}
    </div>
  );
}

/** Что человек заполнил в форме нового клиента */
export interface ClientDraftPayload {
  fullName: string;
  phone: string;
  source: LeadSource;
  managerId?: string;
  /** постоянная скидка клиента в сомони */
  discount?: number;
  extraPhones?: string[];
  sourceDetail?: string;
  address?: string;
  tags?: ClientTag[];
}

export function AddClientModal({
  onClose,
  onCreate,
  isDirector,
  initial,
}: {
  /** уже использованные теги — для подсказки при вводе */
  onClose: () => void;
  onCreate: (
    payload: ClientDraftPayload,
    managerName: string | null,
    order: NewOrderInput | null,
  ) => void;
  isDirector: boolean;
  /**
   * Что было введено в прошлый раз.
   *
   * Нужно, когда сервер отказал: карточка уже исчезла с экрана, и форма
   * открывается заново — заставлять человека набирать имя, телефон, адрес и
   * метраж по второму разу нельзя.
   */
  initial?: {
    payload: ClientDraftPayload;
    managerName: string | null;
    order: NewOrderInput | null;
  };
}) {
  const [fullName, setFullName] = useState(initial?.payload.fullName ?? '');
  const [phone, setPhone] = useState(initial?.payload.phone ?? '');
  // запасные номера «на всякий случай» (ТЗ 1.1)
  /*
    Два номера сразу: второй показывается пустым и обязателен к заполнению —
    так просил заказчик, чтобы база не оставалась с одним контактом.
  */
  const [extraPhones, setExtraPhones] = useState<string[]>(
    initial?.payload.extraPhones?.length ? initial.payload.extraPhones : [''],
  );
  // адрес объекта: спрашиваем один раз здесь, дальше он подставляется в заказы
  const [address, setAddress] = useState(initial?.payload.address ?? '');
  // статусы клиента — те же, что в карточке; можно отметить несколько
  const [tags, setTags] = useState<ClientTag[]>(initial?.payload.tags ?? []);
  // свободные теги (ТЗ 1.2) — в дополнение к единственному статусу
  const [labelInput, setLabelInput] = useState('');
  const [source, setSource] = useState<LeadSource>(
    initial?.payload.source ?? 'CALL',
  );
  // «От кого» — рекомендатель или партнёр (ТЗ 1.4)
  const [sourceDetail, setSourceDetail] = useState(
    initial?.payload.sourceDetail ?? '',
  );
  // постоянная скидка: подставляется в новые заказы клиента
  const [discount, setDiscount] = useState(
    initial?.payload.discount ? String(initial.payload.discount) : '',
  );
  const [managerId, setManagerId] = useState(initial?.payload.managerId ?? '');
  // заявка в воронке
  const [makeOrder, setMakeOrder] = useState(
    initial ? initial.order !== null : true,
  );
  // ещё услуги в заявке (ТЗ 1.3): ключ + объём, цена подставится из справочника
  const [moreServices, setMoreServices] = useState<
    { key: string; qty: string }[]
  >([]);
  /*
   * Свои доп. услуги строками — тот же блок, что в карточке заказа: название,
   * цена, галочка «в счёт». Раньше их можно было дописать только ПОСЛЕ
   * создания, открыв заказ заново, — то есть цену клиенту называли без них.
   */
  const [extraRows, setExtraRows] = useState<
    {
      key: string;
      title: string;
      price: string;
      /** Сколько мест/штук. Пусто — строка в счёт не идёт */
      qty: string;
      checked: boolean;
    }[]
  >(
    (initial?.order?.customExtras ?? []).map((r, i) => ({
      key: `e${i}`,
      title: r.title,
      price: r.price ? String(r.price) : '',
      qty: '1',
      checked: r.checked,
    })),
  );
  const [serviceKey, setServiceKey] = useState(
    initial?.order?.serviceKey ?? 'GENERAL',
  );
  const [dirtLevel, setDirtLevel] = useState<DirtLevel>(
    initial?.order?.dirtLevel ?? 'LIGHT',
  );
  const [area, setArea] = useState(
    initial?.order?.area ? String(initial.order.area) : '',
  );
  const [seats, setSeats] = useState(
    initial?.order?.seats ? String(initial.order.seats) : '',
  );
  const [price, setPrice] = useState('');
  // ТЗ 5: цена за единицу и автоматический расчёт суммы
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [manualPrice, setManualPrice] = useState(false);
  const { data: tariffs } = useFetch<Tariffs>('/tariffs');

  /*
   * «Химчистка мягкой мебели» стоит в форме сразу (просьба владельца):
   * её заказывают часто, и менеджеру остаётся вписать число мест. Цена
   * берётся из справочника «Услуги и цены» — меняется в одном месте.
   * Добавляем один раз и только в НОВУЮ заявку: при правке существующего
   * заказа в форме уже свои строки.
   */
  const defaultExtraAdded = useRef(false);
  useEffect(() => {
    if (defaultExtraAdded.current || initial?.order) return;
    /*
     * Ищем по НАЗВАНИЮ, а не по ключу: услугу владелец мог завести руками
     * через «Услуги и цены», и ключ у неё тогда свой. Название — то, что
     * человек видит и на что ориентируется.
     */
    const preset = (tariffs?.extras ?? []).find((e) =>
      /химчистк.*мебел/i.test(e.title ?? ''),
    );
    if (!preset) return;
    defaultExtraAdded.current = true;
    setExtraRows((prev) =>
      prev.length
        ? prev
        : [
            {
              key: 'preset-upholstery',
              title: preset.title,
              price: String(preset.price),
              qty: '',
              checked: true,
            },
          ],
    );
  }, [tariffs, initial]);
  /*
   * Список ответственных — ВЕСЬ действующий штат, включая руководителей.
   *
   * Именно /users/staff, а не /users/assignable: второй отдаёт рядовому
   * сотруднику только его самого, потому что задачи он ставит лишь себе.
   * Для ответственного правило другое — передать заявку коллеге должен
   * уметь каждый, иначе менеджер заводит клиента на себя и идёт просить
   * руководителя переназначить.
   */
  const { data: managers } = useFetch<Manager[]>('/users/staff');
  const { user: me } = useAuth();
  const currentUserId = me?.id;

  /*
   * По умолчанию ответственный — тот, кто заводит клиента. Так было и раньше
   * (сервер молча ставил создателя), только теперь это видно в поле и
   * поддаётся изменению.
   */
  useEffect(() => {
    if (currentUserId && !managerId) setManagerId(currentUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);
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
      pricePerUnit: price || 0,
      qtyN: qty,
      total: qty * (price || 0),
    };
  });
  const moreSum = moreRows.reduce((sum, r) => sum + r.total, 0);
  // доп. услуги: в счёт идут только отмеченные — ровно как в карточке заказа
  /*
   * Доп. услуги: цена × количество. Пустое количество означает «не берём» —
   * поэтому «Химчистка мягкой мебели» стоит в форме заранее, но в сумму не
   * лезет, пока менеджер не впишет число мест.
   */
  const extraTotal = (r: { price: string; qty: string }) =>
    Math.max(0, Math.round(Number(r.price) || 0)) *
    Math.max(0, Math.round(Number(r.qty) || 0));
  const extrasSum = extraRows.reduce(
    (sum, r) => sum + (r.checked ? extraTotal(r) : 0),
    0,
  );
  const computed = units * unitPrice + moreSum + extrasSum;

  useEffect(() => {
    if (!manualPrice) setPrice(computed ? String(computed) : '');
  }, [computed, manualPrice]);

  /*
   * Что мешает сохранить — списком, а не одним «нельзя».
   *
   * Раньше кнопка просто гасла, и человек не понимал, чего от него хотят:
   * поля выглядели заполненными, а заказ не создавался. Теперь причина
   * названа прямо под кнопкой.
   *
   * Запасной номер БОЛЬШЕ НЕ ОБЯЗАТЕЛЕН (решение владельца): клиента с одним
   * телефоном тоже надо уметь завести. Но если его начали вводить —
   * дописать придётся, иначе в базу уйдёт обрывок.
   */
  const blockers: string[] = [];
  if (!fullName.trim()) blockers.push('ФИО клиента');
  if (!phone.replace(/\D/g, '')) blockers.push('телефон');
  else if (!isValidPhone(phone)) blockers.push('телефон полностью, 9 цифр');
  const extra = extraPhones[0] ?? '';
  if (extra.replace(/\D/g, '').length > 0 && !isValidPhone(extra)) {
    blockers.push('запасной номер полностью или очистите поле');
  }
  /*
   * Адрес обязателен (решение владельца): без него заявку не на что
   * назначить — клинеру некуда ехать, а менеджер потом ищет адрес в
   * переписке. Спрашиваем сразу, пока клиент на линии.
   */
  if (address.trim().length < 4) blockers.push('адрес');
  const canSubmit = blockers.length === 0;

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
          /*
           * Строки без названия не отправляем: пустую строку человек скорее
           * всего добавил и бросил, а сервер бы её честно сохранил, и в
           * карточке заказа висела бы безымянная услуга.
           */
          /*
           * В заказ уходит готовая строка: «Химчистка мягкой мебели × 3» и
           * её итог. Так карточка заказа и КП показывают, из чего сложилась
           * сумма, без обратного пересчёта.
           */
          customExtras: extraRows
            .filter((r) => r.title.trim() && extraTotal(r) > 0)
            .map((r) => {
              const qty = Math.max(0, Math.round(Number(r.qty) || 0));
              return {
                title:
                  qty > 1 ? `${r.title.trim()} × ${qty}` : r.title.trim(),
                price: extraTotal(r),
                checked: r.checked,
              };
            }),
          dirtLevel: hasLevels ? dirtLevel : undefined,
          area: isFurniture ? 0 : toInt(area),
          seats: isFurniture ? toInt(seats) : undefined,
          estimatedPrice: toInt(price),
          pricePerSqm: unitPrice || undefined,
          address: address.trim(),
          /*
           * Итог НЕ отправляем: его считает сервер, и только он знает про
           * постоянную скидку клиента. Пока форма слала свою цифру, скидка
           * не попадала в сумму, а заказ вдобавок помечался «задан вручную» —
           * то есть переставал пересчитываться и дальше.
           */
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
        sourceDetail: sourceDetail.trim() || undefined,
        address: address.trim(),
        tags,
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

        {/* Запасные номера — по желанию: клиента с одним телефоном тоже
            надо уметь завести */}
        <label className="label !mb-0 mt-2">Второй номер</label>
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
            {i > 0 && (
              <button
                type="button"
                onClick={() =>
                  setExtraPhones((prev) => prev.filter((_, j) => j !== i))
                }
                className="press mt-2 shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                aria-label="Убрать номер"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setExtraPhones((prev) => [...prev, ''])}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          + ещё номер телефона
        </button>

        {/*
          Адрес объекта. Спрашиваем при заведении клиента и подставляем в
          заявку: раньше он жил только в заказе, и у клиента без заявки
          адреса не было вовсе — при следующем заказе его спрашивали заново.
        */}
        <div>
          <label className="label">Адрес *</label>
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Район, улица, дом, квартира"
            maxLength={300}
          />
        </div>

        {/*
          Статус клиента — тот же набор, что в карточке, и он один:
          нажатие на новый снимает прежний. Раньше статус ставили только
          потом, открыв карточку, — про него забывали, и воронка стояла
          без пометок.
        */}
        <div>
          <label className="label">Статус клиента</label>
          <div className="flex flex-wrap gap-2">
            {TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  // статус один: нажатие на новый снимает прежний
                  setTags((prev) => (prev.includes(t) ? [] : [t]))
                }
                className={`press rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  tags.includes(t)
                    ? TAG_COLOR[t] + ' ring-2 ring-navy-200'
                    : 'border border-navy-200 bg-white text-navy-600'
                }`}
              >
                {TAG_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Источник</label>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
            ))}
          </select>
          {/*
            «От кого» (ТЗ 1.4): рекомендатель или партнёр. Поле показывается
            только при источнике «Рекомендация» — при звонке или заявке с
            сайта рекомендателя нет, и пустая строка сбивала с толку.
          */}
          {source === 'RECOMMENDATION' && (
          <input
            className="input mt-2"
            value={sourceDetail}
            maxLength={120}
            onChange={(e) => setSourceDetail(e.target.value)}
            placeholder="От кого — например: От Анисы, От Ибодат"
          />
          )}
        </div>

        {/*
          Ответственного выбирает ЛЮБОЙ сотрудник, не только руководитель.
          Раньше поле показывалось лишь директору, а сервер молча назначал
          менеджером того, кто создаёт клиента: передать заявку коллеге было
          нельзя вовсе. По умолчанию подставлен сам создатель — так чаще
          всего и нужно, — но список открыт.
        */}
        <div>
          <label className="label">Ответственный менеджер</label>
          <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">— не назначен —</option>
            {(managers ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
                {m.id === currentUserId ? ' — я' : ''}
              </option>
            ))}
          </select>
        </div>

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
                  {/* единица и цена, затем итог — обе строки не переносятся */}
                  <span className="shrink-0 whitespace-nowrap text-xs font-medium text-navy-700">
                    {r.unit} × {r.pricePerUnit.toLocaleString('ru-RU')}
                  </span>
                  <span className="ml-auto shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-navy-800">
                    {r.total > 0 ? formatPrice(r.total) : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setMoreServices((prev) =>
                        prev.filter((_, j) => j !== i),
                      )
                    }
                    className="press shrink-0 rounded-lg p-1 text-navy-600 hover:text-red-600"
                    aria-label="Убрать услугу"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  </div>
                </div>
              ))}
              {/*
                Добавление услуги — крупная кнопка по центру: её видно, и
                она не теряется среди подписей, как прежняя ссылка.
              */}
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
                className="press mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-navy-300 py-2 text-sm font-semibold text-brand-600 transition hover:border-brand-500 hover:bg-navy-50"
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
                      className={`press rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        dirtLevel === d
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

            {/*
              Доп. услуги — тот же блок, что в карточке заказа (просьба
              владельца: «вот такой»). Строки свободные: название и цена,
              галочка решает, идёт ли строка в счёт, корзинка убирает.
            */}
            <div className="space-y-3 rounded-xl border border-navy-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-navy-800">
                  Доп. услуги
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-navy-600">
                    {extrasSum > 0 ? formatPrice(extrasSum) : 'не добавлены'}
                  </span>
                  <button
                    type="button"
                    className="press flex h-7 w-7 items-center justify-center rounded-lg border border-navy-200 bg-white text-navy-600 hover:bg-navy-50"
                    aria-label="Добавить доп. услугу"
                    title="Добавить доп. услугу"
                    onClick={() =>
                      setExtraRows((prev) => [
                        ...prev,
                        {
                          key: `e${Date.now()}_${prev.length}`,
                          title: '',
                          price: '',
                          qty: '1',
                          checked: true,
                        },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {extraRows.length === 0 && (
                <p className="text-xs text-navy-600">
                  Нажмите «плюс», чтобы вписать свою услугу, её цену и
                  количество.
                </p>
              )}

              <div className="space-y-1.5">
                {extraRows.map((r, i) => (
                  <div
                    key={r.key}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 ${
                      r.checked
                        ? 'border-brand-400 bg-brand-50/60'
                        : 'border-navy-100'
                    }`}
                  >
                    <input
                      className="input input-sm min-w-0 flex-1"
                      value={r.title}
                      placeholder="Название услуги"
                      maxLength={120}
                      onChange={(ev) =>
                        setExtraRows((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, title: ev.target.value } : x,
                          ),
                        )
                      }
                      aria-label="Название доп. услуги"
                    />
                    <input
                      type="number"
                      min={0}
                      className="input input-sm w-20 shrink-0"
                      value={r.price}
                      placeholder="Цена"
                      onChange={(ev) =>
                        setExtraRows((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, price: ev.target.value } : x,
                          ),
                        )
                      }
                      aria-label="Цена доп. услуги"
                    />
                    {/*
                      Количество мест. Пока пусто — строка в сумму не идёт:
                      «Химчистка мягкой мебели» стоит в форме заранее, но
                      деньги за неё добавятся только когда впишут число.
                    */}
                    <input
                      type="number"
                      min={0}
                      className="input input-sm w-16 shrink-0"
                      value={r.qty}
                      placeholder="Кол-во"
                      onChange={(ev) =>
                        setExtraRows((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, qty: ev.target.value } : x,
                          ),
                        )
                      }
                      aria-label="Количество"
                      title="Сколько мест или штук"
                    />
                    {extraTotal(r) > 0 && (
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-navy-700">
                        = {formatPrice(extraTotal(r))}
                      </span>
                    )}
                    {/* галочка: включить строку в сумму заявки */}
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={(ev) =>
                        setExtraRows((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, checked: ev.target.checked } : x,
                          ),
                        )
                      }
                      className="h-4 w-4 shrink-0 accent-brand-600"
                      aria-label="Включить в сумму заявки"
                      title="Включить в сумму заявки"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-lg p-1 text-navy-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Удалить услугу"
                      onClick={() =>
                        setExtraRows((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/*
              Скидка стоит рядом с итогом (решение владельца): раньше она
              была в самом верху формы, среди контактов, и её задавали
              вслепую — не видя суммы, из которой она вычитается.
            */}
            <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Скидка, сомони</label>
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
                    {units > 0 && unitPrice > 0 ? (
                      /*
                       * Раньше здесь стояло «20 × 25 = 1900», хотя 20 × 25
                       * это 500, а 1 900 получалось вместе с доп. услугами.
                       * Теперь расчёт расписан по строкам и сходится.
                       */
                      <span className="block">
                        <span className="block">
                          {isFurniture ? 'Мест' : 'Площадь'}: {units} ×{' '}
                          {unitPrice} = {units * unitPrice} сомони
                        </span>
                        {moreRows
                          .filter((r) => r.qtyN > 0)
                          .map((r, i) => (
                            <span key={i} className="block">
                              {r.title}: {r.qtyN} × {r.pricePerUnit} ={' '}
                              {r.total} сомони
                            </span>
                          ))}
                        {extraRows
                          .filter(
                            (r) =>
                              r.checked && Math.round(Number(r.price) || 0) > 0,
                          )
                          .map((r, i) => (
                            <span key={`x${i}`} className="block">
                              {r.title.trim() || 'Доп. услуга'}:{' '}
                              {Math.round(Number(r.price) || 0)} сомони
                            </span>
                          ))}
                        {(moreSum > 0 || extrasSum > 0) && (
                          <span className="block font-semibold text-navy-800">
                            Итого: {[units * unitPrice, moreSum, extrasSum]
                              .filter((n) => n > 0)
                              .join(' + ')}{' '}
                            = {computed} сомони
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
            </div>
          </div>
        )}

        {/*
          Заявку не создают — скидку всё равно надо где-то задать: она
          постоянная и подставится в следующий заказ клиента.
        */}
        {!makeOrder && (
          <div>
            <label className="label">Скидка, сомони</label>
            <input
              type="number"
              min={0}
              className="input"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0 — без скидки"
            />
          </div>
        )}

        {/*
          Причина, по которой кнопка неактивна, — прямо над ней.
          Раньше кнопка молча гасла: человек видел заполненную форму и не
          понимал, чего не хватает, а подсказка в title на телефоне вообще
          не показывается.
        */}
        {!canSubmit && (
          <p className="pt-2 text-right text-xs text-amber-600">
            Чтобы сохранить, укажите: {blockers.join(', ')}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">Отмена</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            title={canSubmit ? undefined : `Укажите: ${blockers.join(', ')}`}
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
        <ErrorState text={error ?? undefined} onRetry={reload} />
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
