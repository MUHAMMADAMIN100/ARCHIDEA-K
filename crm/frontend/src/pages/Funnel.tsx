import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { ChevronLeft, ChevronRight, FolderClosed } from 'lucide-react';
import { api } from '../api/client';
import { invalidateOrderRelated, useFetch, withMutation } from '../api/hooks';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { Skeleton, PageHeader, Badge, ErrorState } from '../components/ui';
import { DrillValue, DetailModal, DetailStats, DetailTable } from '../components/Drilldown';
import { PeriodFilter, type Period } from '../components/common';
import { rangeOf } from '../lib/date';
import { OrderModal } from '../components/OrderModal';
import { formatPhone } from '../lib/contact';
import {
  AddClientModal,
  type ClientDraftPayload,
  type NewOrderInput,
} from './Clients';
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
  orderSubject,
  serviceTitle,
  isLargeOrder,
  orderDue,
  orderTotal,
} from '../lib/labels';
import { nowISO, tempId } from '../lib/util';
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

/**
 * Сделка закрыта давно, а карточка всё ещё в воронке — значит её внесли
 * задним числом.
 *
 * Такую видно сразу, иначе старый заказ среди свежих читается как сегодняшний.
 * Порог — 45 дней; к переезду в архив он отношения не имеет (тот считается
 * по месяцу оформления и числу карточек).
 */
const OLD_DEAL_DAYS = 45;

function closedLongAgo(o: Order): string | null {
  if (!o.closedAt) return null;
  const days = (Date.now() - new Date(o.closedAt).getTime()) / 86_400_000;
  if (days <= OLD_DEAL_DAYS) return null;
  const when = new Date(o.closedAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
  return o.stage === 'REJECTED' ? `Отказ ${when}` : `Закрыт ${when}`;
}

/**
 * Состояние ведомости по заказу — то, что видно на карточке.
 *
 * Закрытые заказы владелец разбирает ведомостями и раньше не мог понять,
 * по кому отчёт уже готов, а кто остался: приходилось открывать каждый.
 * Черновик система создаёт сама при закрытии заказа, поэтому «нет строки
 * вовсе» и «черновик» для владельца значат одно — не разобран.
 */
type ReportMark = { label: string; className: string } | null;

function reportMark(o: Order): ReportMark {
  // метка только у закрытых: в работе отчёта ещё и быть не должно
  if (o.stage !== 'PAID') return null;
  const status = o.reports?.[0]?.status;
  if (status === 'ACCEPTED') {
    return { label: 'Отчёт ✓', className: 'bg-emerald-100 text-emerald-700' };
  }
  if (status === 'SENT') {
    return { label: 'Отчёт отправлен', className: 'bg-blue-100 text-blue-700' };
  }
  return { label: 'Отчёт: черновик', className: 'bg-amber-100 text-amber-700' };
}

/** Заказ ещё не разобран отчётом — по нему ведомость не отправлена */
function reportPending(o: Order): boolean {
  if (o.stage !== 'PAID') return false;
  const status = o.reports?.[0]?.status;
  return status !== 'ACCEPTED' && status !== 'SENT';
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
      {/*
        На телефоне имя занимает ВСЮ строку, значки уходят под него.
        В одну строку они не помещаются: колонка шириной в полэкрана, и
        «КРУПНЫЙ» с «Потенциальный» отжимали имя в полоску шириной в букву —
        «Мухаммад комп заведение» рассыпался по одной букве в строку.
        На компьютере места хватает, там всё остаётся в одну строку.
      */}
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-2">
        {/* на телефоне шрифт мельче: в половину экрана должно влезть имя целиком */}
        <div className="min-w-0 break-words text-[13px] font-semibold leading-snug text-navy-900 sm:min-w-[8rem] sm:flex-1 sm:text-base">
          {o.client?.fullName}
        </div>
        {/*
          Статус клиента и его теги — в правом верхнем углу карточки: по
          воронке работают глазами, и «VIP» или «Отказник» должны читаться
          до того, как карточку открыли.
        */}
        <div className="flex flex-wrap items-center gap-1 sm:shrink-0 sm:justify-end">
          {/*
            Повторный клиент — мигающая точка.
            Человек обращается к нам не в первый раз: это видно до того, как
            карточку открыли, и разговор с ним начинается иначе. Считаем ВСЕ
            его заявки, включая уехавшие в архив, — поэтому клиент, который
            вернулся через полгода, тоже отмечен.
          */}
          {(o.client?.ordersTotal ?? 1) >= 2 && (
            <span
              className="relative mr-0.5 flex h-2.5 w-2.5 shrink-0"
              title="Повторный клиент — обращается не впервые"
              aria-label="Повторный клиент"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-500" />
            </span>
          )}
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
        </div>
      </div>
      {/* внесённая история: сделка закрыта в прошлом месяце, а карточка свежая */}
      {closedLongAgo(o) && (
        <div className="mt-1 inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
          {closedLongAgo(o)}
        </div>
      )}
      {/* состояние ведомости: по закрытым заказам владелец отчитывается ими */}
      {reportMark(o) && (
        <div
          className={`mt-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${reportMark(o)!.className}`}
        >
          {reportMark(o)!.label}
        </div>
      )}
      {/* телефон нужен прямо в карточке: по воронке чаще всего звонят */}
      {o.client?.phone && (
        <div className="mt-0.5 whitespace-nowrap text-[11px] font-medium text-brand-600 sm:text-xs">
          {formatPhone(o.client.phone)}
        </div>
      )}
      <div className="mt-1 text-[11px] leading-snug text-navy-600 sm:text-xs">
        {orderSubject(o)}
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
          <span className="text-[13px] font-bold text-emerald-700 sm:text-sm">
            Оплачен
            <span className="ml-1 text-xs font-medium text-navy-600">
              {formatPrice(orderTotal(o))}
            </span>
          </span>
        ) : orderDebt(o) > 0 ? (
          <span className="text-[13px] font-bold text-red-700 sm:text-sm">
            Долг {formatPrice(orderDebt(o))}
            {(o.paidAmount ?? 0) > 0 && (
              <span className="ml-1 text-xs font-medium text-navy-600">
                из {orderTotal(o).toLocaleString('ru-RU')}
              </span>
            )}
          </span>
        ) : (
          <span className="text-[13px] font-bold text-navy-700 sm:text-sm">
            {formatPrice(orderTotal(o))}
          </span>
        )}
        {o.cleaners && o.cleaners.length > 0 && (
          <span className="text-xs text-navy-600">👥 {o.cleaners.length}</span>
        )}
      </div>

      {/* Менеджер и дата заявки */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-navy-100 pt-1.5 text-[10px] sm:text-[11px]">
        <span className="shrink-0 text-navy-600">{cardDate(o.createdAt)}</span>
        {/* чип менеджера — сразу видно, кто ведёт заказ */}
        <span className="min-w-0 truncate rounded-md bg-navy-100 px-1.5 py-0.5 font-medium text-navy-600">
          {o.manager?.fullName ?? 'без менеджера'}
        </span>
      </div>

      {/*
        Мобильные контролы смены этапа — только на тач-устройствах и только
        пока заказ не закрыт: у оплаченного этап не меняется ни стрелками,
        ни перетаскиванием.
      */}
      {isTouch && o.stage === 'PAID' && (
        <div className="mt-3 border-t border-navy-100 pt-2 text-center text-xs font-medium text-navy-600">
          Заказ закрыт — этап не меняется
        </div>
      )}

      {isTouch && o.stage !== 'PAID' && (
        <div
          className="mt-3 border-t border-navy-100 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {o.stage === 'REJECTED' ? (
            <button
              onClick={() => onChange(o.id, 'NEW')}
              className="press flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Вернуть в работу
            </button>
          ) : (
            /*
              Три кнопки в карточке шириной в полэкрана.

              Стояли враспор и не сжимались, поэтому вылезали за края
              карточки — на снимке владельца «Назад» и «Далее» пересекали
              рамку. Теперь отступы меньше, ничего не сжимается ниже своего
              содержимого, а на самых узких экранах слова уступают место
              стрелкам: смысл кнопки от этого не теряется, а «Отказ» —
              единственное действие без стрелки — остаётся словом всегда.
            */
            <div className="flex items-center justify-between gap-0.5">
              <button
                onClick={() => prevStage && onChange(o.id, prevStage)}
                disabled={!prevStage}
                className="press flex shrink-0 items-center gap-0.5 rounded-lg px-1 py-1 text-[11px] font-medium text-navy-600 hover:bg-navy-50 disabled:opacity-30 sm:px-1.5 sm:text-xs"
                title={prevStage ? STAGE_LABEL[prevStage] : ''}
                aria-label="Предыдущий этап"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span className="hidden min-[400px]:inline">Назад</span>
              </button>
              <button
                onClick={() => onChange(o.id, 'REJECTED')}
                className="press shrink-0 rounded-lg px-1 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 sm:px-2 sm:text-xs"
              >
                Отказ
              </button>
              <button
                onClick={() => nextStage && onChange(o.id, nextStage)}
                disabled={!nextStage}
                className="press flex shrink-0 items-center gap-0.5 rounded-lg px-1 py-1 text-[11px] font-medium text-navy-600 hover:bg-navy-50 disabled:opacity-30 sm:px-1.5 sm:text-xs"
                title={nextStage ? STAGE_LABEL[nextStage] : ''}
                aria-label="Следующий этап"
              >
                <span className="hidden min-[400px]:inline">Далее</span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Заглушка доски на первую загрузку: те же колонки, шапки этапов и карточки.
 * Крутящийся кружок оставлял экран пустым, и в момент прихода данных вёрстка
 * прыгала с нуля до полной высоты доски.
 */
function BoardSkeleton() {
  return (
    <div
      className="flex gap-3 overflow-hidden pr-4 sm:gap-4 sm:pr-0"
      role="status"
      aria-label="Загрузка"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex w-[74vw] shrink-0 flex-col sm:w-72">
          <Skeleton className="mb-3 h-16 w-full rounded-xl" />
          <div className="space-y-2.5 p-1">
            {Array.from({ length: 3 }).map((_, j) => (
              <Skeleton key={j} className="h-32 w-full rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </div>
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
  // обёртка доски: на ней рисуются растворяющиеся края (см. .scroll-edge)
  const boardWrapRef = useRef<HTMLDivElement>(null);
  // точки под доской: сколько этапов и на каком вы сейчас
  const dotsRef = useRef<HTMLDivElement>(null);
  // стрелки прокрутки: гаснут на краях доски — дальше листать нечего
  const prevBtnRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  /*
   * Шаг стрелки — ровно одна колонка.
   *
   * Раньше здесь стояло 320 px на все случаи. На телефоне колонка — полэкрана
   * (около 170 px), и стрелка проскакивала полтора статуса, останавливаясь
   * между ними. Пока доску возили пальцем, это сглаживалось; теперь на
   * телефоне пальцем её не двигают, и стрелка обязана доводить до соседнего
   * статуса сама. Ширину берём у первой колонки — она меняется с экраном.
   */
  const scrollBoard = (dir: -1 | 1) => {
    const box = boardRef.current;
    if (!box) return;
    const first = box.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
    const step = first ? first.getBoundingClientRect().width + gap : 320;
    box.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  /*
   * Период воронки — по ДАТЕ ОФОРМЛЕНИЯ заявки (решение владельца).
   * По умолчанию текущий месяц: раньше это правило было зашито намертво,
   * теперь им управляет человек — можно посмотреть неделю, квартал или
   * свой отрезок, не заглядывая в архив.
   */
  const [period, setPeriod] = useState<Period>(() => rangeOf('month'));
  const boardUrl = `/orders/board${
    period.from || period.to
      ? `?${period.from ? `from=${period.from}&` : ''}${
          period.to ? `to=${period.to}` : ''
        }`
      : ''
  }`;

  const { data, loading, error, reload, setData } = useFetch<BoardColumn[]>(
    boardUrl,
    {
      deps: [period.from, period.to],
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
    /*
     * Второй замер — после того, как браузер закончил раскладку.
     *
     * Первый приходится на промежуточное состояние: шрифты ещё грузятся,
     * полоса прокрутки страницы то появляется, то исчезает, и доска в этот
     * момент стоит не там, где встанет через кадр. Именно из-за этого на
     * макбуках высота оставалась от старого положения: нижние карточки
     * уходили за край колонки и «проявлялись» только когда наведение мышью
     * заставляло браузер перерисовать блок.
     */
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    const later = window.setTimeout(measure, 300);

    window.addEventListener('resize', measure);
    /*
     * Прокрутка страницы тоже двигает доску: в macOS полоса накладная и
     * появляется поверх содержимого, сдвигая раскладку уже после замера.
     */
    window.addEventListener('scroll', measure, { passive: true });

    /*
     * Следим за фильтрами и за разделом целиком.
     *
     * Фильтры переносятся на вторую строку и сдвигают доску вниз — за ними
     * следили и раньше. Но этого мало: когда у страницы появляется или
     * пропадает полоса прокрутки, меняется ШИРИНА раздела, а вместе с ней
     * съезжает и доска. Наблюдение за main это ловит.
     *
     * За саму доску и за body НЕ следим намеренно: их высоту задаём мы же,
     * и наблюдатель бесконечно будил бы сам себя.
     */
    const ro = new ResizeObserver(measure);
    // блок фильтров — сосед сверху у обёртки доски (сама доска лежит внутри неё)
    const above = el.parentElement?.previousElementSibling;
    if (above) ro.observe(above);
    const watched = el.closest('main');
    if (watched) ro.observe(watched);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(later);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [data]);

  /*
   * Края доски и точка текущего этапа.
   *
   * Признаки ставим прямо в DOM, как это делает ScrollArea: событие прокрутки
   * приходит на каждый кадр, и состояние React перерисовывало бы доску со
   * всеми карточками. Сам ScrollArea здесь не подошёл — доске нужен свой ref
   * (стрелки прокрутки и замер высоты) и своя видимая полоса .board-scroll.
   */
  useEffect(() => {
    const box = boardRef.current;
    const wrap = boardWrapRef.current;
    if (!box || !wrap) return;
    const sync = () => {
      const pos = box.scrollLeft;
      const size = box.clientWidth;
      const full = box.scrollWidth;
      // допуск в пиксель: при дробном масштабе браузера конец не совпадает точно
      const fits = full <= size + 1;
      const atStart = fits || pos <= 1;
      const atEnd = fits || pos + size >= full - 1;
      wrap.setAttribute('data-at-start', String(atStart));
      wrap.setAttribute('data-at-end', String(atEnd));
      /*
       * Стрелка на краю доски гаснет. Раньше на последнем этапе «вперёд»
       * оставалась активной и нажималась впустую: экран не двигался, и
       * непонятно было, кончились этапы или кнопка сломалась.
       */
      if (prevBtnRef.current) prevBtnRef.current.disabled = atStart;
      if (nextBtnRef.current) nextBtnRef.current.disabled = atEnd;

      const dots = dotsRef.current;
      const count = dots?.children.length ?? 0;
      if (dots && count > 1) {
        const step = full / count;
        const active = Math.max(
          0,
          Math.min(count - 1, step > 0 ? Math.round(pos / step) : 0),
        );
        for (let i = 0; i < count; i += 1) {
          (dots.children[i] as HTMLElement).dataset.active = String(i === active);
        }
      }
    };
    sync();
    box.addEventListener('scroll', sync, { passive: true });
    // ширина меняется и без прокрутки: свернули меню, повернули телефон
    const ro = new ResizeObserver(sync);
    ro.observe(box);
    return () => {
      box.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [data]);

  /*
   * Тень под шапкой этапа, когда список карточек прокручен, — единственный
   * знак, что колонка листается: обернуть список в ScrollArea нельзя, его
   * прокруткой управляет библиотека перетаскивания.
   *
   * Один слушатель на всю доску вместо useStuck на колонку: хук нельзя
   * вызывать в цикле по этапам, а метка-датчик внутри Droppable оказалась бы
   * лишним ребёнком списка перетаскивания. Событие прокрутки не всплывает,
   * но доходит до доски на фазе перехвата.
   */
  useEffect(() => {
    const box = boardRef.current;
    if (!box) return;
    const onScroll = (e: Event) => {
      const list = e.target as HTMLElement;
      if (list === box) return; // это горизонтальная прокрутка самой доски
      const head = list.previousElementSibling;
      if (head?.classList.contains('sticky-head')) {
        head.setAttribute('data-stuck', String(list.scrollTop > 0));
      }
    };
    box.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () =>
      box.removeEventListener('scroll', onScroll, { capture: true });
  }, [data]);
  // «Добавить клиента» прямо из воронки — та же форма, что в «Клиентах»
  const [showAddClient, setShowAddClient] = useState(false);
  /*
   * Черновик формы нового клиента: держим его на случай отказа сервера,
   * чтобы вернуть человеку всё введённое, а не пустые поля.
   */
  const [draft, setDraft] = useState<{
    payload: ClientDraftPayload;
    managerName: string | null;
    order: NewOrderInput | null;
  } | null>(null);
  // какой этап открыт в архиве (папка у заголовка колонки)
  const [archiveOf, setArchiveOf] = useState<FunnelStage | null>(null);
  // счётчик над колонкой — не просто число: по клику показываем сам список
  const [stageDrill, setStageDrill] = useState<BoardColumn | null>(null);

  /*
   * ?order=<id> — переход из уведомления сразу в нужную карточку.
   * Ждём загрузки доски: до неё заказа в state ещё нет. Адрес после открытия
   * чистим, иначе карточка будет всплывать снова при каждом возврате назад.
   */
  const [params, setParams] = useSearchParams();
  const wantedOrderId = params.get('order');

  /*
   * Приход с дашборда: ?stage=NEW прокручивает доску к нужному этапу.
   * Раньше карточка-цифра открывала список окном, и до самой воронки
   * человек так и не попадал — а работать он идёт именно туда.
   */
  const wantedStage = params.get('stage');
  useEffect(() => {
    if (!wantedStage || !data) return;
    const index = data.findIndex((c) => c.stage === wantedStage);
    if (index >= 0) {
      requestAnimationFrame(() => {
        const box = boardRef.current;
        const col = box?.children[index] as HTMLElement | undefined;
        if (box && col) {
          box.scrollTo({ left: col.offsetLeft - box.offsetLeft, behavior: 'smooth' });
        }
      });
    }
    setParams({}, { replace: true });
  }, [wantedStage, data]);
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

    /*
     * Из «Оплачено / Закрыто» карточка не двигается никуда.
     *
     * Сделка завершена, доход записан, черновик ведомости создан — тащить
     * такую карточку обратно «в работу» нельзя ни мышью, ни стрелками.
     * Раньше запрет стоял на одном переходе, в «К оплате», а во все
     * остальные колонки карточка уезжала свободно.
     *
     * Ошибочно закрытый заказ возвращает руководитель — из карточки заказа,
     * где смена этапа осознанная и с подтверждением. Тот же запрет стоит на
     * сервере: обойти его прямым запросом нельзя.
     */
    const moving = (data ?? [])
      .flatMap((c) => c.orders)
      .find((o) => o.id === orderId);
    if (moving?.stage === 'PAID') {
      toast.error(
        'Заказ оплачен и закрыт — этап менять нельзя. Вернуть его в работу может руководитель из карточки заказа.',
      );
      return;
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


  if (!data) {
    if (error && !loading) return <ErrorState text={error ?? undefined} onRetry={reload} />;
    return <BoardSkeleton />;
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
      return true;
    }),
  }));

  /*
   * Колонки идут так, как движется сделка: «Новая заявка» первой, дальше
   * по ходу работы. Должников это не прячет — у колонки «К оплате» красная
   * рамка, строка «Из них долг» и красные карточки с недоплатой.
   */
  const board = filtered;

  /*
   * Разметка фильтров одна на два места: в строке заголовка (компьютер) и
   * отдельным блоком под ним (телефон). Ширина разная — на телефоне селекты
   * во всю ширину, на компьютере по содержимому.
   */
  const renderFilters = (mobile: boolean) => (
    <>
      {/* период — по дате оформления заявки; виден всем ролям */}
      <div className={mobile ? 'w-full' : 'flex-none'}>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      {canFilter && (
        <>
          {!mobile && (
            <span className="text-xs font-medium text-navy-600">Менеджер:</span>
          )}
          <select
            className={mobile ? 'input w-full' : 'input w-[190px] flex-none'}
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
      {!mobile && (
        <span className="ml-1 text-xs font-medium text-navy-600">Статус:</span>
      )}
      <select
        className={mobile ? 'input w-full' : 'input w-auto flex-none'}
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
      {(managerFilter !== 'ALL' || tagFilter !== 'ALL') && (
        <button
          onClick={() => {
            setManagerFilter('ALL');
            setTagFilter('ALL');
          }}
          className="press text-xs font-medium text-navy-600 underline-offset-2 hover:underline"
        >
          Сбросить
        </button>
      )}
    </>
  );

  return (
    <div className="animate-page-in">
      {/*
        Фильтры стоят в одной строке с заголовком и кнопкой (решение владельца).
        Раньше они занимали отдельную строку под ним и отодвигали доску вниз —
        на ноутбуке из-за этого терялся целый ряд карточек.

        На телефоне так не выходит: два селекта и кнопка в одну строку не
        помещаются, поэтому там всё остаётся как было — плюс рядом с
        заголовком, фильтры отдельными строками во всю ширину.
      */}
      <PageHeader
        title="Воронка продаж"
        action={
          <>
            <div className="hidden items-center gap-2 sm:flex">
              {renderFilters(false)}
            </div>
            <button
              onClick={() => setShowAddClient(true)}
              className="btn-primary h-10 w-10 p-0 sm:h-auto sm:w-auto sm:px-3.5 sm:py-2"
              aria-label="Добавить клиента"
              title="Добавить клиента"
            >
              <Plus className="h-5 w-5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Добавить клиента</span>
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-2 sm:hidden">{renderFilters(true)}</div>

      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/*
          Обёртка нужна растворяющемуся краю: он рисуется поверх доски, а не
          внутри прокрутки, иначе уезжал бы вместе с колонками.
        */}
        <div
          ref={boardWrapRef}
          className="scroll-edge scroll-edge-x"
          /*
           * Доска лежит прямо на фоне страницы, а он светло-серый. По
           * умолчанию край растворяется в белый — на сером это читалось
           * бы светлой полосой поперёк колонок.
           */
          style={{ ['--fade-bg' as string]: '#f6f7f9' } as React.CSSProperties}
          data-at-start="true"
          data-at-end="true"
        >
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
              // закрытые заказы без отправленной ведомости — «сколько осталось»
              const noReport = col.orders.filter(reportPending).length;
              const isDue = col.stage === 'DONE';
              return (
              <div
                key={col.stage}
                /*
                 * Ширина колонки на телефоне — ровно половина экрана за
                 * вычетом отступов: два этапа с карточками видны разом
                 * (просьба владельца). Было 74vw — влезал один и «огрызок»
                 * второго, и понять, что доска листается, было тяжело.
                 */
                className={`flex w-[calc(50vw-1rem)] shrink-0 snap-start flex-col sm:w-72 ${
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
                      'sm:sticky sm:left-0 sm:z-10 sm:-ml-1 sm:rounded-2xl sm:bg-navy-50 sm:px-1 sm:pt-1'
                    : ''
                }`}
              >
                {/*
                  Шапка этапа: название, сумма денег и количество карточек.
                  Сумма нужна руководителю не меньше количества — по ней видно,
                  сколько денег стоит каждый шаг воронки. Отдельной строкой —
                  сколько из этих денег ещё не получено.

                  z-0 гасит z-20 из .sticky-head: с ним шапка обычного этапа
                  оказалась бы выше закреплённой колонки «К оплате» и рисовалась
                  бы поверх неё при прокрутке доски.
                */}
                <div
                  className={`sticky-head z-0 mb-3 shrink-0 rounded-xl border bg-white px-3 py-2 shadow-card ${
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
                    {/*
                      Папка архива у закрытых этапов. В колонке остаются только
                      сделки текущего месяца (по дате оформления) и не больше 20
                      самых свежих — остальное уходит в папку, чтобы «Оплачено»
                      не разрасталось до сотен карточек (правило владельца,
                      считает сервер).

                      Показываем всегда, даже с нулём (решение владельца):
                      пока папка появлялась только при непустом архиве, было
                      непохоже, что она вообще есть.
                    */}
                    {(col.stage === 'PAID' || col.stage === 'REJECTED') && (
                      <button
                        onClick={() => setArchiveOf(col.stage)}
                        className="press mr-1 inline-flex shrink-0 items-center gap-1 rounded-md border border-navy-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-navy-600 hover:bg-navy-50"
                        title={`Архив этапа «${col.label}»: сделки прошлых месяцев и всё сверх 20 карточек колонки`}
                      >
                        <FolderClosed className="h-3.5 w-3.5" />
                        {col.archived}
                      </button>
                    )}
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
                  {/*
                    Сколько закрытых заказов ещё не разобрано ведомостью.
                    Считаем по карточкам НА ДОСКЕ: в архив уезжают сделки
                    прошлых месяцев, а разбирают отчётами текущую работу.
                  */}
                  {noReport > 0 && (
                    <div className="mt-0.5 whitespace-nowrap text-xs font-semibold text-amber-700">
                      Без отчёта: {noReport}
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
                        className={`card w-72 cursor-pointer border-l-4 p-3.5 text-left shadow-pop ring-1 ring-brand-300 ${
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
                          /*
                            Оплаченная карточка не берётся вовсе: сделка
                            закрыта, доход записан. Раньше она поднималась и
                            уезжала в любую колонку, кроме «К оплате».
                          */
                          isDragDisabled={isTouch || o.stage === 'PAID'}
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

                                Частично оплаченный заказ — это долг клиента.
                                Красная полоса и фон видны в общем списке, не
                                открывая карточку.

                                Подъём под курсором собран утилитами, а не
                                классом .card-interactive: тот на наведении
                                перекрашивает рамку целиком и погасил бы цветную
                                полосу этапа слева.
                              */
                              className={`card cursor-pointer border-l-4 p-3.5 text-left transition-[box-shadow,transform] duration-160 ease-out hover:-translate-y-[3px] hover:shadow-lift ${
                                orderDebt(o) > 0
                                  ? 'border-l-red-500 bg-red-50/70'
                                  : STAGE_BORDER[o.stage]
                              } ${
                                snap.isDragging ? 'shadow-pop ring-1 ring-brand-300' : ''
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
          {/*
            Точки — сколько всего этапов и на каком вы сейчас. На большом
            экране ту же работу делает видимая полоса .board-scroll, поэтому
            там они скрыты. Лежат поверх нижнего отступа раздела: доска
            занимает ровно остаток экрана, и строка под ней вернула бы
            прокрутку всей странице.
          */}
          <div
            ref={dotsRef}
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-3 left-0 right-0 flex items-center justify-center gap-1.5 sm:hidden"
          >
            {board.map((col) => (
              <span key={col.stage} className="swipe-dot" />
            ))}
          </div>

          {/*
            Стрелки прокрутки доски — в правом нижнем углу (ТЗ 2.4).
            Раньше они стояли над доской, в одном ряду с фильтрами: до них
            приходилось тянуться вверх через весь экран, хотя листают доску,
            держа палец внизу. Здесь же они не спорят с точками — те по центру.
          */}
          <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex items-center gap-1">
            <button
              ref={prevBtnRef}
              onClick={() => scrollBoard(-1)}
              className="press pointer-events-auto rounded-lg border border-navy-200 bg-white p-1.5 text-navy-600 shadow-card transition-colors hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white"
              aria-label="Прокрутить доску влево"
              title="Влево"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              ref={nextBtnRef}
              onClick={() => scrollBoard(1)}
              className="press pointer-events-auto rounded-lg border border-navy-200 bg-white p-1.5 text-navy-600 shadow-card transition-colors hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white"
              aria-label="Прокрутить доску вправо"
              title="Вправо"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </DragDropContext>

      {archiveOf && (
        <ArchiveModal
          stage={archiveOf}
          onPick={(o) => {
            setArchiveOf(null);
            setOpenOrder(o);
          }}
          onClose={() => setArchiveOf(null)}
        />
      )}

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
          full
          isDirector={canFilter}
          /* при отказе сервера возвращаем форму со всем, что было введено */
          initial={draft ?? undefined}
          onClose={() => {
            setShowAddClient(false);
            setDraft(null);
          }}
          onCreate={(payload, managerName, order: NewOrderInput | null) => {
            /*
             * Карточка встаёт в воронку СРАЗУ, до ответа сервера.
             *
             * Раньше форма закрывалась, а заявка появлялась только после
             * полного перезапроса доски — секунды три на глаз. Человек в это
             * время не понимал, сохранилось у него что-нибудь или нет.
             */
            setShowAddClient(false);
            setDraft(null);

            const tempOrderId = tempId();
            const price = order
              ? (order.finalPrice ?? order.estimatedPrice ?? 0)
              : 0;
            if (order) {
              const card: Order = {
                id: tempOrderId,
                clientId: tempId(),
                managerId: payload.managerId,
                stage: 'NEW',
                source: payload.source,
                cleaningType: order.cleaningType,
                serviceKey: order.serviceKey ?? null,
                dirtLevel: order.dirtLevel ?? null,
                area: order.area,
                seats: order.seats ?? null,
                address: order.address ?? payload.address,
                estimatedPrice: order.estimatedPrice,
                finalPrice: order.finalPrice ?? null,
                isLarge: isLargeOrder({
                  finalPrice: order.finalPrice ?? null,
                  estimatedPrice: order.estimatedPrice,
                }),
                createdAt: nowISO(),
                client: {
                  id: '',
                  fullName: payload.fullName,
                  phone: payload.phone,
                  tags: payload.tags ?? [],
                },
                manager: managerName
                  ? { id: payload.managerId ?? '', fullName: managerName }
                  : undefined,
                cleaners: [],
              };
              setData((cols) =>
                cols
                  ? cols.map((c) =>
                      c.stage === 'NEW'
                        ? {
                            ...c,
                            orders: [card, ...c.orders],
                            amount: (c.amount ?? 0) + price,
                          }
                        : c,
                    )
                  : cols,
              );
            }

            void (async () => {
              try {
                /*
                 * Оба запроса — под защитой от гонки с чтением: живой канал
                 * узнаёт о создании клиента и перечитывает доску раньше, чем
                 * создан заказ. Без защиты временная карточка на секунду
                 * перетиралась ответом без заказа и «мигала».
                 */
                await withMutation(async () => {
                  const client = (
                    await api.post('/clients', {
                      ...payload,
                      // заявка идёт следом: уведомление в Telegram отправит
                      // она, одним сообщением со всеми данными
                      withOrder: !!order,
                    })
                  ).data as { id: string };
                  if (order) {
                    await api.post('/orders', {
                      clientId: client.id,
                      source: payload.source,
                      managerId: payload.managerId,
                      ...order,
                      // клиент создан только что — в Telegram уходит
                      // «Новая заявка в CRM» со всеми данными
                      newClient: true,
                    });
                  }
                });
                toast.success(
                  order ? 'Клиент и заявка созданы' : 'Клиент создан',
                );
                // тихая сверка: подменяем временную карточку настоящей
                reload();
              } catch (e: any) {
                // карточку убираем и открываем форму заново — набранное цело
                setData((cols) =>
                  cols
                    ? cols.map((c) =>
                        c.stage === 'NEW'
                          ? {
                              ...c,
                              orders: c.orders.filter(
                                (o) => o.id !== tempOrderId,
                              ),
                              amount: Math.max(0, (c.amount ?? 0) - price),
                            }
                          : c,
                      )
                    : cols,
                );
                setDraft({ payload, managerName, order });
                setShowAddClient(true);
                toast.error(
                  e?.response?.data?.message || 'Не удалось создать клиента',
                );
              }
            })();
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
 * Статусы клиента в строке списка — те же метки, что на карточках воронки.
 *
 * В расшифровке этапа и в архиве имя стояло голым: чтобы узнать, что «Шукрона»
 * — VIP, приходилось открывать карточку. Статус — то, по чему решают, как
 * говорить с клиентом, поэтому он должен быть виден в любом списке.
 */
function ClientTagChips({ order }: { order: Order }) {
  const tags = order.client?.tags ?? [];
  if (tags.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${TAG_COLOR[t]}`}
        >
          {TAG_LABEL[t]}
        </span>
      ))}
    </div>
  );
}

/**
 * Все заказы одного этапа списком: суммы, объём, ответственный. На доске
 * карточки видны не все сразу (колонка скроллится), а здесь этап виден
 * целиком — с итогом по деньгам, которого на доске нет вообще.
 */
/**
 * Архив этапа: сделки прошлых месяцев и всё сверх 20 карточек колонки.
 *
 * Отдельным запросом, а не вместе с доской: архив открывают редко, и тянуть
 * его на каждое обновление воронки незачем. Нажатие на строку открывает
 * карточку заказа — оттуда его можно вернуть в работу, сменив этап.
 */
function ArchiveModal({
  stage,
  onPick,
  onClose,
}: {
  stage: FunnelStage;
  onPick: (order: Order) => void;
  onClose: () => void;
}) {
  const { data, loading } = useFetch<Order[]>(`/orders/archive?stage=${stage}`);
  const rows = data ?? [];
  const sum = rows.reduce((s, o) => s + orderTotal(o), 0);

  return (
    <DetailModal
      title={`Архив — ${STAGE_LABEL[stage]}`}
      subtitle="Сделки прошлых месяцев и всё сверх 20 карточек колонки. Чтобы вернуть заказ в работу, откройте его и смените этап"
      onClose={onClose}
    >
      <DetailStats
        items={[
          { label: 'Заказов', value: rows.length },
          { label: 'На сумму', value: formatPrice(sum), tone: 'success' },
        ]}
      />
      <DetailTable
        rows={rows}
        rowKey={(o) => o.id}
        onRowClick={onPick}
        emptyText={loading ? 'Загружаем архив…' : 'В архиве пока пусто'}
        columns={[
          {
            key: 'client',
            header: 'Клиент',
            cell: (o) => (
              <div>
                <div className="font-medium text-navy-900">
                  {o.client?.fullName}
                </div>
                <ClientTagChips order={o} />
                <div className="text-xs text-navy-600">
                  закрыт {o.closedAt ? cardDate(o.closedAt) : cardDate(o.createdAt)}
                </div>
              </div>
            ),
          },
          {
            key: 'what',
            header: 'Уборка',
            cell: (o) => (
              <div>
                <div className="text-navy-800">{serviceTitle(o)}</div>
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
              <span className="font-bold text-navy-900">
                {formatPrice(orderTotal(o))}
              </span>
            ),
          },
        ]}
      />
    </DetailModal>
  );
}

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
                <ClientTagChips order={o} />
                <div className="text-xs text-navy-600">{cardDate(o.createdAt)}</div>
              </div>
            ),
          },
          {
            key: 'what',
            header: 'Уборка',
            cell: (o) => (
              <div>
                <div className="text-navy-800">{serviceTitle(o)}</div>
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
