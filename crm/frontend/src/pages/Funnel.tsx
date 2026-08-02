import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api/client';
import { invalidateOrderRelated, useFetch } from '../api/hooks';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { Spinner, PageHeader, Badge, ErrorState } from '../components/ui';
import { DrillValue, DetailModal, DetailStats, DetailTable } from '../components/Drilldown';
import { OrderModal } from '../components/OrderModal';
import { AddClientModal, type NewOrderInput } from './Clients';
import { Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  STAGE_COLOR,
  STAGE_LABEL,
  STAGE_ORDER,
  TAG_COLOR,
  TAG_LABEL,
  TYPE_LABEL,
  formatPrice,
  formatVolume,
  orderDue,
  orderTotal,
} from '../lib/labels';
import { userSeesAll } from '../types';
import type { BoardColumn, ClientTag, FunnelStage, Order } from '../types';

// основной конвейер этапов (без «Отказа» — он отдельной кнопкой на мобильном)
const PIPELINE: FunnelStage[] = STAGE_ORDER.filter((s) => s !== 'REJECTED');

/** Короткая дата для карточки: «27 июл» */
function cardDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
  });
}

const NO_MANAGER = '__none__';

/**
 * Долг по заказу — то, что не получено, когда работа уже сдана.
 * До этапа «К оплате» заявка в работе, и денег ещё не ждут: красить всю
 * воронку в красный бессмысленно, выделение перестанет что-либо значить.
 */
function orderDebt(o: Order): number {
  return o.stage === 'DONE' ? orderDue(o) : 0;
}

/** Статусы клиента для фильтра воронки */
const CLIENT_TAGS: ClientTag[] = ['VIP', 'REGULAR', 'POTENTIAL', 'REFUSED'];

/** Цвет левой рамки карточки по этапу воронки */
const STAGE_BORDER: Record<FunnelStage, string> = {
  NEW: 'border-l-navy-300',
  PROCESSING: 'border-l-blue-400',
  INSPECTION: 'border-l-amber-400',
  OFFER: 'border-l-purple-400',
  CONFIRMED: 'border-l-cyan-400',
  IN_PROGRESS: 'border-l-indigo-400',
  DONE: 'border-l-teal-400',
  PAID: 'border-l-emerald-500',
  REJECTED: 'border-l-red-400',
};

// Тело карточки заказа. Вынесено на уровень модуля (а не внутрь Funnel),
// чтобы при поллинге/оптимистичных обновлениях карточки НЕ пересоздавались
// (иначе новая ссылка на компонент → полный ремоунт всех карточек и рывок).
function OrderCardBody({
  o,
  isTouch,
  onChange,
}: {
  o: Order;
  isTouch: boolean;
  onChange: (orderId: string, newStage: FunnelStage) => void;
}) {
  const idx = PIPELINE.indexOf(o.stage);
  const prevStage = idx > 0 ? PIPELINE[idx - 1] : null;
  const nextStage =
    idx >= 0 && idx < PIPELINE.length - 1 ? PIPELINE[idx + 1] : null;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 font-semibold text-navy-900">
          {o.client?.fullName}
        </div>
        {/*
          Статус клиента и его теги — в правом верхнем углу карточки: по
          воронке работают глазами, и «VIP» или «Отказник» должны читаться
          до того, как карточку открыли.
        */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {o.isLarge && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              КРУПНЫЙ
            </span>
          )}
          {(o.client?.tags ?? []).map((t) => (
            <span
              key={t}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${TAG_COLOR[t]}`}
            >
              {TAG_LABEL[t]}
            </span>
          ))}
          {(o.client?.labels ?? []).slice(0, 2).map((l) => (
            <span
              key={l}
              className="rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-semibold text-navy-700"
            >
              {l}
            </span>
          ))}
          {(o.client?.labels ?? []).length > 2 && (
            <span className="rounded bg-navy-100 px-1 py-0.5 text-[10px] font-semibold text-navy-700">
              +{(o.client?.labels ?? []).length - 2}
            </span>
          )}
        </div>
      </div>
      {/* телефон нужен прямо в карточке: по воронке чаще всего звонят */}
      {o.client?.phone && (
        <div className="mt-0.5 text-xs font-medium text-brand-600">
          +992 {o.client.phone}
        </div>
      )}
      <div className="mt-1 text-xs text-navy-600">
        {TYPE_LABEL[o.cleaningType]} · {formatVolume(o)}
      </div>
      {/*
        Главное число карточки — сколько ещё предстоит получить: заказчик
        просил видеть в воронке именно остаток, а не первоначальную сумму.
        Полная стоимость идёт припиской, чтобы она не потерялась. Отдельный
        случай — заказ оплачен целиком: остаток нулевой, и вместо «0 сомони»
        показываем «Оплачен» и полную сумму, иначе заработанные деньги
        выглядели бы как ноль.
      */}
      <div className="mt-2 flex items-center justify-between">
        {(o.paidAmount ?? 0) > 0 && orderDue(o) === 0 ? (
          <span className="text-sm font-bold text-emerald-700">
            Оплачен
            <span className="ml-1 text-xs font-medium text-navy-600">
              {formatPrice(orderTotal(o))}
            </span>
          </span>
        ) : orderDebt(o) > 0 ? (
          <span className="text-sm font-bold text-red-700">
            Долг {formatPrice(orderDebt(o))}
            {(o.paidAmount ?? 0) > 0 && (
              <span className="ml-1 text-xs font-medium text-navy-600">
                из {orderTotal(o).toLocaleString('ru-RU')}
              </span>
            )}
          </span>
        ) : (
          <span className="text-sm font-bold text-navy-700">
            {formatPrice(orderTotal(o))}
          </span>
        )}
        {o.cleaners && o.cleaners.length > 0 && (
          <span className="text-xs text-navy-600">👥 {o.cleaners.length}</span>
        )}
      </div>

      {/* Менеджер и дата заявки */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-navy-100 pt-1.5 text-[11px]">
        <span className="shrink-0 text-navy-600">{cardDate(o.createdAt)}</span>
        {/* чип менеджера — сразу видно, кто ведёт заказ */}
        <span className="min-w-0 truncate rounded-md bg-navy-100 px-1.5 py-0.5 font-medium text-navy-600">
          {o.manager?.fullName ?? 'без менеджера'}
        </span>
      </div>

      {/* Мобильные контролы смены этапа — только на тач-устройствах */}
      {isTouch && (
        <div
          className="mt-3 border-t border-navy-100 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {o.stage === 'REJECTED' ? (
            <button
              onClick={() => onChange(o.id, 'NEW')}
              className="flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Вернуть в работу
            </button>
          ) : (
            <div className="flex items-center justify-between gap-1">
              <button
                onClick={() => prevStage && onChange(o.id, prevStage)}
                disabled={!prevStage}
                className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-medium text-navy-600 hover:bg-navy-50 disabled:opacity-30"
                title={prevStage ? STAGE_LABEL[prevStage] : ''}
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </button>
              <button
                onClick={() => onChange(o.id, 'REJECTED')}
                className="rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
              >
                Отказ
              </button>
              <button
                onClick={() => nextStage && onChange(o.id, nextStage)}
                disabled={!nextStage}
                className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-medium text-navy-600 hover:bg-navy-50 disabled:opacity-30"
                title={nextStage ? STAGE_LABEL[nextStage] : ''}
              >
                Далее
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function Funnel() {
  const toast = useToast();
  /*
   * Открываем раздел с самого верха. Браузер помнит прокрутку предыдущей
   * страницы, и на телефоне воронка нередко открывалась уже пролистанной —
   * шапка с фильтрами оказывалась выше экрана.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const dialog = useDialog();
  const { user } = useAuth();
  // фильтр по менеджеру — только для тех, кто видит всю компанию
  const canFilter = userSeesAll(user);
  const [managerFilter, setManagerFilter] = useState<string>('ALL');
  // отбор карточек по клиенту: статус (VIP и т.д.) и свободный тег
  const [tagFilter, setTagFilter] = useState<ClientTag | 'ALL'>('ALL');
  const [labelFilter, setLabelFilter] = useState<string>('ALL');
  // на тач-устройствах (телефон/планшет) перетаскивание неудобно —
  // отключаем drag и показываем стрелки для смены этапа
  const isTouch = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: coarse)').matches,
    [],
  );

  // счётчик незавершённых операций смены этапа + флаг перетаскивания —
  // пока они активны, авто-обновление доски на паузе (иначе карточка
  // «доезжает и сбрасывается», когда поллинг подтянет старое состояние)
  const draggingRef = useRef(false);
  const inFlightRef = useRef(0);
  // доска: прокрутка стрелками — мышью тянуть полосу неудобно на большом экране
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollBoard = (dir: -1 | 1) =>
    boardRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  const { data, loading, error, reload, setData } = useFetch<BoardColumn[]>(
    '/orders/board',
    {
      pollMs: 10000,
      pollPaused: () => draggingRef.current || inFlightRef.current > 0,
    },
  );
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  /*
   * Доска занимает весь остаток экрана под шапкой и фильтрами: страница
   * целиком больше не прокручивается, листаются только карточки внутри
   * колонки. Высоту считаем от реального положения доски, а не формулой
   * с «примерно такой-то шапкой»: фильтры переносятся на вторую строку на
   * узком экране, и любая константа врала бы.
   */
  const [boardHeight, setBoardHeight] = useState<number>();

  /*
   * Зависимость от data обязательна: пока доска грузится, компонент
   * возвращает Spinner и самого блока в разметке ещё нет. Эффект с пустым
   * списком зависимостей отрабатывал один раз по пустой ссылке и больше
   * не вызывался — высота так и не проставлялась.
   */
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      /*
       * top берём относительно окна, без прибавки прокрутки: высота считается
       * от места доски на экране до нижнего края окна. Раньше здесь
       * складывались две системы координат — документная и оконная, — и
       * доска получалась вдвое выше экрана.
       */
      const top = el.getBoundingClientRect().top;
      /*
       * Нижний отступ раздела вычитаем по факту, а не константой: иначе
       * доска на пару десятков пикселей выше экрана, и страница всё равно
       * прокручивается — ровно то, от чего уходили.
       */
      const main = el.closest('main');
      const padBottom = main
        ? parseFloat(getComputedStyle(main).paddingBottom) || 0
        : 0;
      const next = Math.max(
        320,
        Math.round(window.innerHeight - top - padBottom - 4),
      );
      // порог в 2px: без него наблюдатель размеров зациклился бы сам на себе
      setBoardHeight((prev) =>
        prev !== undefined && Math.abs(prev - next) < 2 ? prev : next,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    /*
     * Фильтры переносятся на вторую строку и сдвигают доску вниз. Следим за
     * блоком фильтров, а не за body: body меняет высоту вслед за доской, и
     * наблюдение за ним давало бесконечный пересчёт.
     */
    const ro = new ResizeObserver(measure);
    // блок фильтров — прямой сосед доски сверху
    const above = el.previousElementSibling;
    if (above) ro.observe(above);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [data]);
  // «Добавить клиента» прямо из воронки — та же форма, что в «Клиентах»
  const [showAddClient, setShowAddClient] = useState(false);
  // счётчик над колонкой — не просто число: по клику показываем сам список
  const [stageDrill, setStageDrill] = useState<BoardColumn | null>(null);

  /*
   * ?order=<id> — переход из уведомления сразу в нужную карточку.
   * Ждём загрузки доски: до неё заказа в state ещё нет. Адрес после открытия
   * чистим, иначе карточка будет всплывать снова при каждом возврате назад.
   */
  const [params, setParams] = useSearchParams();
  const wantedOrderId = params.get('order');
  useEffect(() => {
    if (!wantedOrderId || !data) return;
    const found = data.flatMap((c) => c.orders).find((o) => o.id === wantedOrderId);
    if (found) setOpenOrder(found);
    else toast.error('Заказ не найден — возможно, он удалён');
    setParams({}, { replace: true });
  }, [wantedOrderId, data]);

  // Оптимистичное перемещение карточки между этапами (до ответа сервера)
  const applyPatch = (orderId: string, patch: Partial<Order>) => {
    setData((cols) => {
      if (!cols) return cols;
      let moved: Order | undefined;
      const without = cols.map((c) => ({
        ...c,
        orders: c.orders.filter((o) => {
          if (o.id === orderId) {
            moved = { ...o, ...patch };
            return false;
          }
          return true;
        }),
      }));
      if (!moved) return cols;
      const target = patch.stage ?? moved.stage;
      return without.map((c) =>
        c.stage === target ? { ...c, orders: [moved as Order, ...c.orders] } : c,
      );
    });
  };

  /**
   * Смена этапа заказа — общая логика для drag (ПК) и стрелок (мобильный).
   * Оптимистично: карточка переезжает мгновенно, запрос уходит в фон,
   * доску не перезапрашиваем; откат только при ошибке.
   */
  const changeStage = async (orderId: string, newStage: FunnelStage) => {
    /*
     * «Оплачено / Закрыто» — только после полного расчёта. Иначе заказ
     * уходит из воронки вместе с недоплатой, и деньги теряются из виду.
     * Тот же запрет стоит на сервере: обойти его через прямой запрос нельзя.
     */
    if (newStage === 'PAID') {
      const order = (data ?? [])
        .flatMap((c) => c.orders)
        .find((o) => o.id === orderId);
      const due = order ? orderDue(order) : 0;
      if (due > 0) {
        toast.error(
          `Нельзя закрыть: клиент должен ${formatPrice(due)} из ${formatPrice(
            orderTotal(order!),
          )}. Внесите оплату в карточке заказа.`,
        );
        return;
      }
    }

    let rejectionReason: string | undefined;
    if (newStage === 'REJECTED') {
      const reason = await dialog.prompt({
        title: 'Причина отказа',
        message: 'Укажите, почему клиент отказался.',
        placeholder: 'Например: дорого, выбрали другую компанию',
        confirmText: 'Сохранить',
      });
      if (!reason) return; // отмена — не двигаем
      rejectionReason = reason;
    }

    applyPatch(orderId, { stage: newStage, rejectionReason });
    inFlightRef.current += 1;
    try {
      await api.patch(`/orders/${orderId}/stage`, {
        stage: newStage,
        rejectionReason,
      });
      /*
       * Смена этапа порождает записи в других разделах: осмотр — выезд в
       * «Сменах», оплата — черновик ведомости и запись дохода. Забываем их
       * кэш, чтобы при переходе туда данные загрузились заново, а не показали
       * состояние до перетаскивания.
       */
      invalidateOrderRelated();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сменить этап');
      reload(); // вернуть серверное состояние
    } finally {
      inFlightRef.current -= 1;
    }
  };

  const onDragStart = () => {
    draggingRef.current = true;
  };

  const onDragEnd = (result: DropResult) => {
    // клик после отпускания приходит раньше таймера и будет подавлен
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
    const { source, destination, draggableId } = result;
    if (!destination || source.droppableId === destination.droppableId) return;
    void changeStage(draggableId, destination.droppableId as FunnelStage);
  };

  /*
   * Все теги, встречающиеся на доске, — варианты для фильтра.
   * Хук стоит ДО раннего выхода ниже: пока данные не пришли, компонент
   * возвращает Spinner, и хук, объявленный после выхода, вызывался бы не на
   * каждом рендере — React падал с ошибкой о разном числе хуков.
   */
  const labelOptions = useMemo(
    () =>
      [
        ...new Set(
          (data ?? []).flatMap((c) =>
            c.orders.flatMap((o) => o.client?.labels ?? []),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b, 'ru')),
    [data],
  );

  if (!data) {
    if (error && !loading) return <ErrorState text={error ?? undefined} onRetry={reload} />;
    return <Spinner />;
  }

  // менеджеры, у которых есть заказы (для выпадающего фильтра)
  const managerOptions = (() => {
    const map = new Map<string, string>();
    let hasNone = false;
    for (const col of data) {
      for (const o of col.orders) {
        if (o.manager) map.set(o.manager.id, o.manager.fullName);
        else hasNone = true;
      }
    }
    const list = [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return { list, hasNone };
  })();

  // доска с учётом фильтра по менеджеру
  const filtered = data.map((col) => ({
    ...col,
    orders: col.orders.filter((o) => {
      if (canFilter && managerFilter !== 'ALL') {
        const ok =
          managerFilter === NO_MANAGER
            ? !o.manager
            : o.manager?.id === managerFilter;
        if (!ok) return false;
      }
      if (tagFilter !== 'ALL' && !(o.client?.tags ?? []).includes(tagFilter)) {
        return false;
      }
      if (
        labelFilter !== 'ALL' &&
        !(o.client?.labels ?? []).includes(labelFilter)
      ) {
        return false;
      }
      return true;
    }),
  }));

  /*
   * Колонки идут так, как движется сделка: «Новая заявка» первой, дальше
   * по ходу работы. Должников это не прячет — у колонки «К оплате» красная
   * рамка, строка «Из них долг» и красные карточки с недоплатой.
   */
  const board = filtered;

  return (
    <div>
      <PageHeader
        title="Воронка продаж"
        action={
          <button onClick={() => setShowAddClient(true)} className="btn-primary">
            <Plus className="h-4 w-4" />
            Добавить клиента
          </button>
        }
        subtitle={
          isTouch
            ? 'Изменяйте этап стрелками или нажмите на карточку для деталей'
            : 'Перетаскивайте карточки между этапами или нажмите для деталей'
        }
      />

      {/*
        Панель отбора. Выбор менеджера — только тем, кто видит всю компанию;
        статус клиента и тег нужны каждому, кто работает с воронкой.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canFilter && (
          <>
          <span className="text-xs font-medium text-navy-600">Менеджер:</span>
          <select
            className="input max-w-[240px]"
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
          >
            <option value="ALL">Все менеджеры</option>
            {managerOptions.list.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {managerOptions.hasNone && (
              <option value={NO_MANAGER}>Без менеджера</option>
            )}
          </select>
          </>
        )}
          {/* Отбор по клиенту: статус и свободный тег */}
          <label className="ml-1 text-xs font-medium text-navy-600">Статус:</label>
          <select
            className="input input-sm w-auto"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value as ClientTag | 'ALL')}
          >
            <option value="ALL">Все статусы</option>
            {CLIENT_TAGS.map((t) => (
              <option key={t} value={t}>
                {TAG_LABEL[t]}
              </option>
            ))}
          </select>

          {labelOptions.length > 0 && (
            <>
              <label className="ml-1 text-xs font-medium text-navy-600">Тег:</label>
              <select
                className="input input-sm w-auto"
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
              >
                <option value="ALL">Все теги</option>
                {labelOptions.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </>
          )}

          {(managerFilter !== 'ALL' ||
            tagFilter !== 'ALL' ||
            labelFilter !== 'ALL') && (
            <button
              onClick={() => {
                setManagerFilter('ALL');
                setTagFilter('ALL');
                setLabelFilter('ALL');
              }}
              className="text-xs font-medium text-navy-600 underline-offset-2 hover:text-navy-600 hover:underline"
            >
              Сбросить
            </button>
          )}

          {/*
            Стрелки прокрутки доски. Этапов девять, на экран они не влезают, и
            тянуть полосу мышью через всю страницу неудобно.
          */}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => scrollBoard(-1)}
              className="btn-ghost px-2 py-1"
              aria-label="Прокрутить доску влево"
              title="Влево"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => scrollBoard(1)}
              className="btn-ghost px-2 py-1"
              aria-label="Прокрутить доску вправо"
              title="Вправо"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
      </div>

      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/*
          Отступ справа на телефоне: без него последняя колонка упиралась
          ровно в край экрана и обрезалась на середине слова («Нов…», «Сумм…»).
          С sm: и выше — прежние отступы и промежуток, десктоп не меняется.
        */}
        <div
          ref={boardRef}
          style={boardHeight ? { height: boardHeight } : undefined}
          className="board-scroll flex snap-x snap-mandatory gap-3 pr-4 sm:snap-none sm:gap-4 sm:pr-0"
        >
          {board.map((col) => {
            /*
             * Сумма этапа — полная стоимость заказов, а не остаток к оплате:
             * это деньги, которые компания на этапе заработала. Считаем по
             * карточкам колонки, а не берём готовое число сервера, — иначе
             * при фильтре по менеджеру шапка показывала бы итог всей доски.
             */
            const total = col.orders.reduce((sum, o) => sum + orderTotal(o), 0);
            // долг по этапу: сумма остатков заказов, где оплата ещё не полная
            const debt = col.orders.reduce((sum, o) => sum + orderDebt(o), 0);
            const isDue = col.stage === 'DONE';
            return (
            <div
              key={col.stage}
              className={`flex w-[85vw] shrink-0 snap-start flex-col sm:w-72 ${
                isDue
                  ? /*
                     * Прилипает к левому краю: список должников виден, до
                     * каких бы этапов ни докрутили доску. Только с sm: и
                     * выше — на телефоне закреплённая колонка накрыла бы
                     * почти весь экран и читать остальные было бы нечем.
                     */
                    /*
                     * z-10, а не z-20: колонке достаточно быть выше соседних
                     * колонок доски. С z-20 она вставала вровень с шапкой
                     * приложения и, будучи ниже по разметке, перекрывала её —
                     * выпадающие уведомления и меню пользователя уходили под
                     * карточки должников.
                     */
                    'sm:sticky sm:left-0 sm:z-10 sm:-ml-1 sm:rounded-2xl sm:bg-navy-50/95 sm:px-1 sm:pt-1 sm:backdrop-blur'
                  : ''
              }`}
            >
              {/*
                Шапка этапа: название, сумма денег и количество карточек.
                Сумма нужна руководителю не меньше количества — по ней видно,
                сколько денег стоит каждый шаг воронки. Отдельной строкой —
                сколько из этих денег ещё не получено.
              */}
              <div
                className={`mb-3 shrink-0 rounded-xl border bg-white px-3 py-2 ${
                  isDue ? 'border-red-300 ring-1 ring-red-200' : 'border-navy-100'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  {/*
                    Название этапа занимает всё свободное место и при нехватке
                    ширины сокращается многоточием, а не переносится посреди
                    слова. Счётчик не сжимается и остаётся на своей строке.
                  */}
                  <span className="min-w-0 flex-1">
                    <Badge className={`${STAGE_COLOR[col.stage]} max-w-full`}>
                      <span className="min-w-0 truncate">{col.label}</span>
                    </Badge>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-navy-600">
                    <DrillValue
                      tone="muted"
                      disabled={col.orders.length === 0}
                      title={`Все заказы на этапе «${col.label}» с суммами`}
                      onClick={() => setStageDrill(col)}
                    >
                      {col.orders.length}
                    </DrillValue>
                  </span>
                </div>
                <div className="mt-1 whitespace-nowrap text-xs text-navy-600">
                  Сумма:{' '}
                  <span className="font-bold text-navy-800">
                    {formatPrice(total)}
                  </span>
                </div>
                {/* сколько из этой суммы — недоплата по уже начатым заказам */}
                {debt > 0 && (
                  <div className="mt-0.5 whitespace-nowrap text-xs font-semibold text-red-700">
                    Из них долг: {formatPrice(debt)}
                  </div>
                )}
              </div>

              {/*
                renderClone обязателен: колонка прокручивается, и поднятая
                карточка обрезалась её краем — на экране оставалось пустое
                место, пока держишь. Клон рисуется поверх доски и виден
                целиком на всём пути переноса.
              */}
              <Droppable
                droppableId={col.stage}
                isDropDisabled={isTouch}
                renderClone={(p, _snap, rubric) => {
                  const o = col.orders[rubric.source.index];
                  return (
                    <div
                      ref={p.innerRef}
                      {...p.draggableProps}
                      {...p.dragHandleProps}
                      className={`card w-72 cursor-pointer border-l-4 p-3.5 text-left shadow-xl ring-2 ring-navy-300 ${
                        orderDebt(o) > 0
                          ? 'border-l-red-500 bg-red-50/70'
                          : STAGE_BORDER[o.stage]
                      }`}
                    >
                      <OrderCardBody
                        o={o}
                        isTouch={isTouch}
                        onChange={changeStage}
                      />
                    </div>
                  );
                }}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    /*
                     * Карточки листаются внутри колонки. Библиотека
                     * перетаскивания сама прокручивает этот блок, когда
                     * тянешь карточку к его краю, — переносить заказ между
                     * этапами по-прежнему можно.
                     */
                    className={`min-h-0 flex-1 space-y-2.5 overflow-y-auto rounded-2xl p-1 transition-colors ${
                      snapshot.isDraggingOver ? 'bg-navy-100/60' : ''
                    }`}
                  >
                    {col.orders.map((o, index) => (
                      <Draggable
                        key={o.id}
                        draggableId={o.id}
                        index={index}
                        isDragDisabled={isTouch}
                      >
                        {(p, snap) => (
                          <div
                            ref={p.innerRef}
                            {...p.draggableProps}
                            {...p.dragHandleProps}
                            onClick={() => {
                              // это был драг, а не клик — модалку не открываем
                              if (draggingRef.current) return;
                              setOpenOrder(o);
                            }}
                            /*
                              Цветная рамка по этапу — как на образце: этап
                              карточки виден, не читая шапку колонки.
                            */
                            /*
                              Частично оплаченный заказ — это долг клиента.
                              Красная полоса и фон видны в общем списке, не
                              открывая карточку.
                            */
                            className={`card cursor-pointer border-l-4 p-3.5 text-left transition-shadow hover:shadow-lg ${
                              orderDebt(o) > 0
                                ? 'border-l-red-500 bg-red-50/70'
                                : STAGE_BORDER[o.stage]
                            } ${
                              snap.isDragging ? 'shadow-xl ring-2 ring-navy-300' : ''
                            }`}
                          >
                            <OrderCardBody
                              o={o}
                              isTouch={isTouch}
                              onChange={changeStage}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {col.orders.length === 0 && !snapshot.isDraggingOver && (
                      <div className="rounded-xl border border-dashed border-navy-200 py-6 text-center text-xs text-navy-600">
                        {isTouch ? 'Нет заказов' : 'Перетащите сюда'}
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
            );
          })}
        </div>
      </DragDropContext>

      {stageDrill && (
        <StageOrdersModal
          column={stageDrill}
          onPick={(o) => {
            setStageDrill(null);
            setOpenOrder(o);
          }}
          onClose={() => setStageDrill(null)}
        />
      )}

      {/*
        Форма нового клиента — ТОТ ЖЕ компонент, что и в «Клиентах»: одна
        форма, один вид. Кнопка в шапке взводила состояние, а этого блока
        не было — клик выглядел «неработающим».
      */}
      {showAddClient && (
        <AddClientModal
          isDirector={canFilter}
          onClose={() => setShowAddClient(false)}
          onCreate={async (payload, _managerName, order: NewOrderInput | null) => {
            try {
              const client = (await api.post('/clients', payload)).data as {
                id: string;
              };
              if (order) {
                await api.post('/orders', {
                  clientId: client.id,
                  source: payload.source,
                  managerId: payload.managerId,
                  ...order,
                });
              }
              reload();
              toast.success(order ? 'Клиент и заявка созданы' : 'Клиент создан');
            } catch (e: any) {
              toast.error(
                e?.response?.data?.message || 'Не удалось создать клиента',
              );
            }
          }}
        />
      )}

      <OrderModal
        orderId={openOrder?.id ?? null}
        initial={openOrder ?? undefined}
        onClose={() => setOpenOrder(null)}
        onUpdated={reload}
        onOptimistic={applyPatch}
        onDeleted={(oid) =>
          setData((cols) =>
            cols
              ? cols.map((c) => ({
                  ...c,
                  orders: c.orders.filter((o) => o.id !== oid),
                }))
              : cols,
          )
        }
      />
    </div>
  );
}

// ───────────── Расшифровка счётчика над колонкой ─────────────

/**
 * Все заказы одного этапа списком: суммы, объём, ответственный. На доске
 * карточки видны не все сразу (колонка скроллится), а здесь этап виден
 * целиком — с итогом по деньгам, которого на доске нет вообще.
 */
function StageOrdersModal({
  column,
  onPick,
  onClose,
}: {
  column: BoardColumn;
  onPick: (order: Order) => void;
  onClose: () => void;
}) {
  // как и в шапке колонки: сумма — полная стоимость, долг — отдельно
  const priceOf = (o: Order) => orderTotal(o);
  const sum = column.orders.reduce((s, o) => s + priceOf(o), 0);
  const debt = column.orders.reduce(
    (s, o) => s + ((o.paidAmount ?? 0) > 0 ? orderDue(o) : 0),
    0,
  );

  return (
    <DetailModal
      title={column.label}
      subtitle="Все заказы на этом этапе"
      onClose={onClose}
    >
      <DetailStats
        items={[
          { label: 'Заказов', value: column.orders.length },
          { label: 'На сумму', value: formatPrice(sum), tone: 'success' },
          ...(debt > 0
            ? [
                {
                  label: 'Из них долг',
                  value: formatPrice(debt),
                  tone: 'danger' as const,
                },
              ]
            : []),
        ]}
      />

      <DetailTable
        rows={column.orders}
        rowKey={(o) => o.id}
        onRowClick={onPick}
        emptyText="На этом этапе заказов нет"
        columns={[
          {
            key: 'client',
            header: 'Клиент',
            cell: (o) => (
              <div>
                <div className="font-medium text-navy-900">{o.client?.fullName}</div>
                <div className="text-xs text-navy-600">{cardDate(o.createdAt)}</div>
              </div>
            ),
          },
          {
            key: 'what',
            header: 'Уборка',
            cell: (o) => (
              <div>
                <div className="text-navy-800">{TYPE_LABEL[o.cleaningType]}</div>
                <div className="text-xs text-navy-600">
                  {formatVolume(o)}
                  {o.address ? ` · ${o.address}` : ''}
                </div>
              </div>
            ),
          },
          {
            key: 'manager',
            header: 'Ответственный',
            cell: (o) => (
              <span className="text-navy-600">{o.manager?.fullName ?? '—'}</span>
            ),
          },
          {
            key: 'price',
            header: 'Сумма',
            align: 'right',
            cell: (o) => (
              <div>
                <div className="font-bold text-navy-900">{formatPrice(priceOf(o))}</div>
                {(o.paidAmount ?? 0) > 0 && orderDue(o) > 0 && (
                  <div className="text-xs font-semibold text-red-700">
                    долг {orderDue(o).toLocaleString('ru-RU')}
                  </div>
                )}
              </div>
            ),
          },
        ]}
        footer={
          column.orders.length > 0 ? (
            <tr className="border-t border-navy-100 font-bold text-navy-900">
              <td className="px-3 py-2" colSpan={3}>
                Итого на этапе
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatPrice(sum)}</td>
            </tr>
          ) : undefined
        }
      />

      <p className="mt-3 text-xs text-navy-600">
        Нажмите на заказ, чтобы открыть его карточку.
      </p>
    </DetailModal>
  );
}
