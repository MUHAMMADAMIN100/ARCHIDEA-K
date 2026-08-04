import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Phone,
  BellRing,
  Plus,
  Inbox,
} from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useToast } from '../components/Toast';
import { Skeleton, PageHeader, ErrorState, Modal } from '../components/ui';
import { BrigadeLoad } from '../components/BrigadeLoad';
import { TaskModal } from '../components/TaskModal';
import { OrderModal } from '../components/OrderModal';
import {
  TASK_TYPE_COLOR,
  TASK_TYPE_DOT,
  TASK_STATUS_LABEL,
  STAGE_COLOR,
  STAGE_LABEL,
  STAGE_ORDER,
  formatPrice,
  orderDue,
  orderTotal,
} from '../lib/labels';
import { tempId, nowISO } from '../lib/util';
import { useAuth } from '../auth/AuthContext';
import { formatPhone } from '../lib/contact';
import type {
  BoardColumn,
  Callback,
  FunnelStage,
  Order,
  Reminder,
  Task,
  TaskType,
} from '../types';

type View = 'month' | 'week';

/**
 * Цвет карточки заказа по этапу воронки. Берём тот же STAGE_COLOR, что и в
 * самой воронке — этап должен выглядеть одинаково во всех разделах — и
 * добавляем рамку, чтобы карточки не сливались в плотной сетке месяца.
 */
const STAGE_BORDER: Record<FunnelStage, string> = {
  NEW: 'border-navy-200',
  PROCESSING: 'border-blue-200',
  INSPECTION: 'border-amber-200',
  OFFER: 'border-purple-200',
  CONFIRMED: 'border-cyan-200',
  IN_PROGRESS: 'border-indigo-200',
  DONE: 'border-teal-200',
  PAID: 'border-green-200',
  REJECTED: 'border-red-200',
};

/** Точка-маркер этапа для фильтра и легенды */
const STAGE_DOT: Record<FunnelStage, string> = {
  NEW: 'bg-navy-400',
  PROCESSING: 'bg-blue-500',
  INSPECTION: 'bg-amber-500',
  OFFER: 'bg-purple-500',
  CONFIRMED: 'bg-cyan-500',
  IN_PROGRESS: 'bg-indigo-500',
  DONE: 'bg-teal-500',
  PAID: 'bg-green-500',
  REJECTED: 'bg-red-500',
};

/**
 * Дата уборки заказа: назначенная, а пока её нет — желаемая клиентом.
 * Иначе заявки со свежего лендинга не попадали бы в календарь вообще,
 * хотя дату клиент уже назвал.
 */
function orderDate(o: Order): string | null {
  return o.scheduledDate ?? o.preferredDate ?? null;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const NO_DATE = 'no-date'; // droppable-колонка «Без срока»

/** Локальный ключ дня «YYYY-MM-DD» (без сдвига часового пояса) */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Понедельник недели, в которую попадает дата */
function mondayOf(d: Date): Date {
  const res = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (res.getDay() + 6) % 7; // Вс=0 → 6
  res.setDate(res.getDate() - shift);
  return res;
}

function addDays(d: Date, n: number): Date {
  const res = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  res.setDate(res.getDate() + n);
  return res;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «7 августа 2026 г.» из ключа дня — заголовок списка выбранного дня */
function humanDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Задача ещё не сохранена на сервере (оптимистичная) — действия с ней недоступны */
const isTemp = (id: string) => id.startsWith('temp_');

/** Карточка задачи — на уровне модуля, чтобы не пересоздавалась при обновлениях */
function TaskCard({ task, compact }: { task: Task; compact: boolean }) {
  const done = task.status === 'DONE';
  return (
    <div
      className={`rounded-lg border px-2 py-1.5 text-left shadow-card transition-[box-shadow,transform] duration-120 ease-out hover:-translate-y-px hover:shadow-lift ${
        TASK_TYPE_COLOR[task.type]
      } ${done ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${TASK_TYPE_DOT[task.type]}`}
        />
        <span
          className={`min-w-0 flex-1 truncate text-xs font-semibold ${
            done ? 'line-through' : ''
          }`}
        >
          {task.title}
        </span>
      </div>
      {!compact && (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-3">
          {task.assignments.slice(0, 3).map((a) => (
            <span
              key={a.id}
              className="rounded bg-white/70 px-1 text-[10px] font-medium"
              title={`${a.user.fullName} — ${TASK_STATUS_LABEL[a.status]}`}
            >
              {a.user.fullName.split(' ')[0]}
              {a.status === 'DONE' ? ' ✓' : a.status === 'IN_PROGRESS' ? ' •' : ''}
            </span>
          ))}
          {task.assignments.length > 3 && (
            <span className="text-[10px] font-medium opacity-70">
              +{task.assignments.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Карточка заказа в клетке календаря — цвет по этапу воронки */
function OrderCard({ order, compact }: { order: Order; compact: boolean }) {
  return (
    <div
      className={`rounded-lg border px-2 py-1.5 text-left shadow-card transition-[box-shadow,transform] duration-120 ease-out hover:-translate-y-px hover:shadow-lift ${
        STAGE_COLOR[order.stage]
      } ${STAGE_BORDER[order.stage]}`}
    >
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
            STAGE_DOT[order.stage]
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {order.client?.fullName ?? 'Клиент'}
        </span>
      </div>
      {/* сумма заказа целиком; если часть уже внесена — долг припиской */}
      <div className="mt-0.5 truncate pl-3 text-[11px] font-medium tabular-nums">
        {formatPrice(orderTotal(order))}
        {(order.paidAmount ?? 0) > 0 && orderDue(order) > 0 && (
          <span className="ml-1 font-bold text-red-700">
            долг {orderDue(order).toLocaleString('ru-RU')}
          </span>
        )}
      </div>
      {!compact && order.address && (
        <div className="truncate pl-3 text-[10px] opacity-80">
          {order.address}
        </div>
      )}
    </div>
  );
}

/**
 * Строка заказа в списке дня.
 *
 * В отличие от карточки в клетке здесь есть вся ширина экрана: имя клиента,
 * этап, адрес и сумма читаются целиком, без обрезки.
 */
function DayOrderRow({
  order,
  onOpen,
}: {
  order: Order;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press flex w-full items-center gap-2.5 rounded-xl border border-navy-100 bg-white p-2.5 text-left shadow-card transition duration-120 ease-out hover:-translate-y-px hover:bg-navy-50 hover:shadow-lift"
    >
      <span
        className={`h-9 w-1 shrink-0 rounded-full ${STAGE_DOT[order.stage]}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-navy-900">
          {order.client?.fullName ?? 'Клиент'}
        </span>
        <span className="mt-0.5 block truncate text-xs text-navy-600">
          {STAGE_LABEL[order.stage]}
          {order.address ? ` · ${order.address}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block whitespace-nowrap text-sm font-bold tabular-nums text-navy-800">
          {formatPrice(orderTotal(order))}
        </span>
        {(order.paidAmount ?? 0) > 0 && orderDue(order) > 0 && (
          <span className="block whitespace-nowrap text-[11px] font-bold tabular-nums text-red-700">
            долг {orderDue(order).toLocaleString('ru-RU')}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Отметка «позвонить» в списке дня.
 *
 * Оранжевая — чтобы перезвон не терялся среди уборок и задач: это дело на
 * конкретный час, а не работа на весь день.
 */
function CallbackRow({
  item,
  onOpen,
}: {
  item: Callback;
  onOpen: () => void;
}) {
  const at = item.callbackAt ? new Date(item.callbackAt) : null;
  const time = at
    ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    : '';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press flex w-full items-center gap-2.5 rounded-xl border border-orange-200 bg-orange-50 p-2.5 text-left shadow-card transition duration-120 ease-out hover:-translate-y-px hover:bg-orange-100 hover:shadow-lift"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
        <Phone className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-navy-900">
          Позвонить · {item.fullName}
        </span>
        <span className="mt-0.5 block truncate text-xs text-navy-600">
          {formatPhone(item.phone)}
          {item.interestLevel ? ` · ${item.interestLevel}` : ''}
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-orange-700">
        {time}
      </span>
    </button>
  );
}

/** Строка задачи в списке дня */
function DayTaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const done = task.status === 'DONE';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press flex w-full items-center gap-2.5 rounded-xl border border-navy-100 bg-white p-2.5 text-left shadow-card transition duration-120 ease-out hover:-translate-y-px hover:bg-navy-50 hover:shadow-lift"
    >
      <span
        className={`h-9 w-1 shrink-0 rounded-full ${TASK_TYPE_DOT[task.type]}`}
      />
      <span
        className={`min-w-0 flex-1 truncate text-sm font-medium text-navy-900 ${
          done ? 'line-through opacity-60' : ''
        }`}
      >
        {task.title}
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs text-navy-600">
        {TASK_STATUS_LABEL[task.status]}
      </span>
    </button>
  );
}

export function Calendar() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTouch = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: coarse)').matches,
    [],
  );

  const draggingRef = useRef(false);
  const inFlightRef = useRef(0);

  const { data, loading, error, reload, setData } = useFetch<Task[]>('/tasks', {
    pollMs: 20000,
    pollPaused: () => draggingRef.current || inFlightRef.current > 0,
  });

  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  // единственный фильтр календаря — этапы воронки (те же, что в «Воронке»)
  const [stageFilter, setStageFilter] = useState<FunnelStage | 'ALL'>('ALL');
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  /*
   * Узкий экран — телефон.
   *
   * Проверяем именно ширину, а не «палец вместо мыши»: на планшете места
   * хватает, и там остаётся обычная сетка с карточками. Слушаем изменения,
   * чтобы поворот экрана переключал вид без перезагрузки страницы.
   */
  const [isNarrow, setIsNarrow] = useState(
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(max-width: 639.98px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 639.98px)');
    if (!mq) return;
    const onChange = () => setIsNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /*
   * Выбранный день. На телефоне тап по клетке не открывает окно поверх
   * календаря, а обновляет список под сеткой — месяц при этом остаётся на
   * месте. При входе выбран сегодняшний день: свои дела видно сразу.
   */
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date()));
  /** Открыто ли окно с делами выбранного дня */
  const [dayOpen, setDayOpen] = useState(false);
  // «Без даты» на телефоне свёрнут в строку со счётчиком
  const [undatedOpen, setUndatedOpen] = useState(false);

  /*
   * Заказы берём из той же доски, что и воронка: один запрос, общий кэш —
   * переключение между разделами мгновенное, а этапы гарантированно совпадают.
   */
  const boardQuery = useFetch<BoardColumn[]>('/orders/board', {
    pollMs: 20000,
  });

  /*
   * Перезвоны клиентов — оранжевые отметки «позвонить».
   *
   * Берём весь список без диапазона: перезвонов в работе десятки, а не
   * тысячи, зато при листании месяцев не нужен новый запрос на каждый шаг.
   */
  const callbacksQuery = useFetch<Callback[]>('/clients/callbacks', {
    pollMs: 60000,
  });

  /*
   * Напоминания из одноимённого раздела — в календаре их не было вовсе.
   * Поставили напоминание, а планируете день по календарю — и оно не
   * попадалось на глаза до самого срока. Берём незакрытые: выполненные
   * в плане дня уже не нужны.
   */
  const remindersQuery = useFetch<Reminder[]>('/reminders', {
    pollMs: 60000,
  });
  // в модалке храним ТОЛЬКО id — саму задачу берём из свежих данных,
  // иначе статусы, изменённые внутри модалки, не были бы видны
  const [modal, setModal] = useState<
    { mode: 'create'; date: string | null } | { mode: 'edit'; id: string } | null
  >(null);

  const todayKey = dayKey(new Date());

  // видимый диапазон дней
  const days = useMemo(() => {
    if (view === 'week') {
      const start = mondayOf(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const start = mondayOf(first);
    const end = addDays(mondayOf(last), 6);
    const total = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    return Array.from({ length: total }, (_, i) => addDays(start, i));
  }, [view, cursor]);

  // задачи по дням (с учётом фильтра типа)
  const { byDay, undated } = useMemo(() => {
    const map = new Map<string, Task[]>();
    const none: Task[] = [];
    for (const t of data ?? []) {
      if (!t.deadline) {
        none.push(t);
        continue;
      }
      const key = dayKey(new Date(t.deadline));
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return { byDay: map, undated: none };
  }, [data]);

  // перезвоны по дням — из карточек клиентов
  const callbacksByDay = useMemo(() => {
    const map = new Map<string, Callback[]>();
    for (const c of callbacksQuery.data ?? []) {
      if (!c.callbackAt) continue;
      const key = dayKey(new Date(c.callbackAt));
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [callbacksQuery.data]);

  const remindersByDay = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    for (const r of remindersQuery.data ?? []) {
      // выполненные и отменённые в плане дня не нужны
      if (!r.remindAt || r.status === 'DONE' || r.status === 'CANCELLED') continue;
      const key = dayKey(new Date(r.remindAt));
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return map;
  }, [remindersQuery.data]);

  // заказы по дням уборки (с учётом фильтра этапа)
  const { ordersByDay, ordersUndated } = useMemo(() => {
    const map = new Map<string, Order[]>();
    const none: Order[] = [];
    for (const col of boardQuery.data ?? []) {
      if (stageFilter !== 'ALL' && col.stage !== stageFilter) continue;
      for (const o of col.orders) {
        const iso = orderDate(o);
        if (!iso) {
          none.push(o);
          continue;
        }
        const key = dayKey(new Date(iso));
        const list = map.get(key);
        if (list) list.push(o);
        else map.set(key, [o]);
      }
    }
    return { ordersByDay: map, ordersUndated: none };
  }, [boardQuery.data, stageFilter]);

  const title =
    view === 'week'
      ? (() => {
          const s = days[0];
          const e = days[6];
          const sameMonth = s.getMonth() === e.getMonth();
          return `${s.getDate()}${
            sameMonth ? '' : ` ${s.toLocaleDateString('ru-RU', { month: 'short' })}`
          } – ${e.getDate()} ${e.toLocaleDateString('ru-RU', {
            month: 'long',
            year: 'numeric',
          })}`;
        })()
      : capitalize(
          cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
        );

  const shift = (dir: number) =>
    setCursor((c) =>
      view === 'week'
        ? addDays(c, dir * 7)
        : new Date(c.getFullYear(), c.getMonth() + dir, 1),
    );

  /**
   * Точки под числом дня: есть ли дела и насколько они горят.
   *
   * Цвет берём по САМОЙ СРОЧНОЙ задаче дня — иначе одна серая точка не
   * отличает «завтра позвонить» от «просрочено вчера», и смысл отметки
   * теряется. Точек не больше трёх: клетка на телефоне шириной сорок
   * пикселей, четвёртая уже не помещается.
   */
  const dayDots = (key: string): string[] => {
    const tasks = byDay.get(key) ?? [];
    const orders = ordersByDay.get(key) ?? [];
    if (tasks.length === 0 && orders.length === 0) return [];

    const open = tasks.filter((t) => t.status !== 'DONE');

    // всё, что было на день, закрыто — зелёная точка: день отработан
    if (open.length === 0 && orders.length === 0) return ['bg-green-500'];

    const worst =
      open.some((t) => t.priority === 'URGENT') || (key < todayKey && open.length > 0)
        ? 'bg-red-500'
        : open.some((t) => t.priority === 'HIGH')
          ? 'bg-amber-500'
          : open.length > 0
            ? 'bg-brand-500'
            : 'bg-navy-300';

    const total = Math.min(3, open.length + orders.length);
    // первая точка — цветом срочности, остальные нейтральные: они лишь
    // показывают, что дел на день несколько
    return Array.from({ length: total }, (_, i) => (i === 0 ? worst : 'bg-navy-300'));
  };

  /**
   * Клик по дню открывает окно с делами этого дня по центру экрана.
   *
   * Раньше день раскрывался списком ПОД сеткой, и страницу подкручивало
   * вниз. На большом экране список уезжал за нижний край: человек нажимал
   * на 14 августа и не понимал, произошло ли что-нибудь. Окно по центру
   * видно сразу и одинаково на компьютере и на телефоне.
   */
  const pickDay = (key: string) => {
    setSelectedDay(key);
    setDayOpen(true);
  };

  /** Оптимистичное изменение задачи в списке */
  const patchTask = (id: string, patch: Partial<Task>) =>
    setData((list) =>
      list ? list.map((t) => (t.id === id ? { ...t, ...patch } : t)) : list,
    );

  /** Перенос задачи на другой день (драг) — мгновенно, запрос в фоне */
  const moveTask = async (id: string, toKey: string | null) => {
    const prev = (data ?? []).find((t) => t.id === id);
    if (!prev) return;
    const deadline = toKey ? `${toKey}T12:00:00.000Z` : null;
    patchTask(id, { deadline });
    inFlightRef.current += 1;
    try {
      await api.patch(`/tasks/${id}/date`, { deadline: toKey });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось перенести задачу');
      patchTask(id, { deadline: prev.deadline ?? null }); // откат
    } finally {
      inFlightRef.current -= 1;
    }
  };

  const onDragEnd = (result: DropResult) => {
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
    const { source, destination, draggableId } = result;
    if (!destination || source.droppableId === destination.droppableId) return;
    void moveTask(
      draggableId,
      destination.droppableId === NO_DATE ? null : destination.droppableId,
    );
  };

  /** Создание задачи — появляется в календаре сразу */
  const createTask = (
    payload: {
      title: string;
      description?: string;
      type: TaskType;
      priority: Task['priority'];
      deadline: string | null;
      assigneeIds: string[];
      clientId: string | null;
    },
    people: { id: string; fullName: string }[],
  ) => {
    const id = tempId();
    const optimistic: Task = {
      id,
      title: payload.title,
      description: payload.description,
      type: payload.type,
      priority: payload.priority,
      status: 'OPEN',
      deadline: payload.deadline ? `${payload.deadline}T12:00:00.000Z` : null,
      assigneeId: payload.assigneeIds[0],
      creatorId: user?.id ?? '',
      assignee: {
        id: payload.assigneeIds[0],
        fullName: people[0]?.fullName ?? '',
      },
      creator: { id: user?.id ?? '', fullName: user?.fullName ?? '' },
      assignments: people.map((p) => ({
        id: `${id}:${p.id}`,
        userId: p.id,
        status: 'OPEN' as const,
        user: { id: p.id, fullName: p.fullName },
      })),
      createdAt: nowISO(),
    };
    setData((list) => (list ? [optimistic, ...list] : [optimistic]));
    api
      .post('/tasks', payload)
      .then(() => reload())
      .catch((e) => {
        toast.error(e?.response?.data?.message || 'Не удалось создать задачу');
        setData((list) => (list ? list.filter((t) => t.id !== id) : list));
      });
  };

  if (!data) {
    if (error && !loading) return <ErrorState text={error ?? undefined} onRetry={reload} />;
    /*
     * Заглушка повторяет сетку месяца: те же семь колонок и та же высота
     * клетки. Кружок посреди пустого экрана не показывал, что грузится
     * календарь, а появление сетки сдвигало страницу на целый экран вниз.
     */
    return (
      <div className="animate-page-in">
        <div className="mb-2 grid grid-cols-7 gap-1 sm:gap-2">
          {WEEKDAYS.map((w) => (
            <Skeleton key={w} className="h-3 w-8" />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton
              key={i}
              className="aspect-square rounded-xl sm:aspect-auto sm:h-[104px]"
            />
          ))}
        </div>
      </div>
    );
  }

  // актуальная версия открытой задачи (не снимок на момент клика)
  const liveTask =
    modal?.mode === 'edit' ? data.find((t) => t.id === modal.id) : undefined;

  const cellMin = view === 'week' ? 'min-h-[260px]' : 'min-h-[104px]';

  return (
    <div className="animate-page-in">
      <PageHeader
        title="Календарь"
        action={
          <button
            onClick={() => setModal({ mode: 'create', date: todayKey })}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" />
            Новая задача
          </button>
        }
      />

      {/* Панель: вид, навигация, период */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-navy-100 p-1">
          {(['month', 'week'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`press rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                view === v
                  ? 'bg-white text-navy-900 shadow-card'
                  : 'text-navy-600 hover:text-navy-800'
              }`}
            >
              {v === 'month' ? 'Месяц' : 'Неделя'}
            </button>
          ))}
        </div>

        {/*
          На 320 px ряд «стрелки — месяц — Сегодня» не влезал: под заголовок
          отводилось 170 px. Теперь на телефоне он занимает всю строку целиком,
          а заголовок держится в одну линию (без nowrap он рассыпался по букве
          на строку) и растягивается между стрелками.
        */}
        <div className="flex w-full items-center gap-1 sm:w-auto">
          <button
            onClick={() => shift(-1)}
            className="press shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 sm:p-2"
            title="Назад"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 whitespace-nowrap text-center text-xs font-bold text-navy-900 sm:min-w-[170px] sm:flex-none sm:text-sm">
            {title}
          </span>
          <button
            onClick={() => shift(1)}
            className="press shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 sm:p-2"
            title="Вперёд"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="press ml-1 shrink-0 rounded-xl border border-navy-200 px-2 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50 sm:ml-2 sm:px-3 sm:text-sm"
          >
            Сегодня
          </button>
        </div>
      </div>

      {/* Фильтр по этапам воронки — те же названия и цвета, что в «Воронке» */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/*
          Этапы. На телефоне — один селект: семь кнопок занимали там три
          ряда и отодвигали сам календарь за нижний край экрана. С sm: и
          выше остаются кнопки, десктоп не меняется.
        */}
        <span className="text-xs font-medium text-navy-600">Этап:</span>
        <select
          className="input w-full sm:hidden"
          value={stageFilter}
          onChange={(e) =>
            setStageFilter(e.target.value as FunnelStage | 'ALL')
          }
          aria-label="Этап воронки"
        >
          <option value="ALL">Все этапы</option>
          {STAGE_ORDER.map((st) => (
            <option key={st} value={st}>
              {STAGE_LABEL[st]}
            </option>
          ))}
        </select>
        {(['ALL', ...STAGE_ORDER] as (FunnelStage | 'ALL')[]).map((st) => (
          <button
            key={st}
            onClick={() => setStageFilter(st)}
            className={`press hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:inline-flex ${
              stageFilter === st
                ? 'bg-brand-500 text-white'
                : 'bg-navy-100 text-navy-600 hover:bg-navy-200'
            }`}
          >
            {st !== 'ALL' && (
              <span
                className={`h-2 w-2 rounded-full ${
                  stageFilter === st ? 'bg-white' : STAGE_DOT[st]
                }`}
              />
            )}
            {st === 'ALL' ? 'Все' : STAGE_LABEL[st]}
          </button>
        ))}
      </div>

      <DragDropContext
        onDragStart={() => {
          draggingRef.current = true;
        }}
        onDragEnd={onDragEnd}
      >
        {/* Шапка дней недели — в мобильной неделе не нужна, там строки */}
        {(!isNarrow || view === 'month') && (
          <div className="mb-2 grid grid-cols-7 gap-1 sm:gap-2">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="text-center text-xs font-semibold text-navy-600 sm:text-left"
              >
                {w}
              </div>
            ))}
          </div>
        )}

        {isNarrow && view === 'month' && (
          /*
           * Сетка месяца на телефоне.
           *
           * Карточек с текстом здесь нет намеренно: в колонке шириной около
           * сорока пикселей обрезалось и имя клиента, и сумма — читать было
           * нечего. Остаётся число дня и счётчики: синий — уборки, серый —
           * задачи. Подробности показывает список под сеткой.
           */
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const key = dayKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = key === todayKey;
              const picked = key === selectedDay;
              /*
               * Одно число на день: уборки и задачи вместе, статус не важен.
               * Два числа рядом в клетке шириной сорок пикселей читались как
               * одно — «1 1» выглядело как одиннадцать.
               */
              const calls = callbacksByDay.get(key)?.length ?? 0;
              const count =
                (ordersByDay.get(key)?.length ?? 0) +
                (byDay.get(key)?.length ?? 0) +
                (remindersByDay.get(key)?.length ?? 0) +
                calls;
              const dots = dayDots(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickDay(key)}
                  aria-label={`${humanDay(key)}: дел ${count}`}
                  className={`press flex aspect-square flex-col items-center justify-center rounded-xl border-2 transition-colors ${
                    /* сегодня — заливка цветом логотипа во всю клетку */
                    isToday
                      ? 'bg-brand-500 text-white'
                      : 'bg-white text-navy-800'
                  } ${
                    /* выбранный день — тёмная рамка: видна и на белой клетке, и на залитой */
                    picked
                      ? 'border-navy-900'
                      : isToday
                        ? 'border-brand-500'
                        : 'border-navy-100'
                  } ${inMonth ? '' : 'opacity-40'}`}
                >
                  <span className="text-sm font-semibold tabular-nums">
                    {d.getDate()}
                  </span>
                  {/*
                    Точки под числом: сразу видно, что на день назначены дела
                    и насколько они горят. Цвет — по самой срочной задаче,
                    поэтому просроченный день не спутать с обычным.
                    Оранжевая точка перезвона идёт последней, как и раньше.
                  */}
                  <span className="mt-0.5 flex h-3 items-center gap-[3px] leading-none">
                    {dots.map((c, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${
                          isToday ? 'bg-white' : c
                        }`}
                      />
                    ))}
                    {calls > 0 && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isToday ? 'bg-white' : 'bg-orange-500'
                        }`}
                      />
                    )}
                    {count > 0 && dots.length === 0 && calls === 0 && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isToday ? 'bg-white' : 'bg-navy-300'
                        }`}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {isNarrow && view === 'week' && (
          /*
           * Неделя на телефоне — семь строк сверху вниз.
           *
           * Семь колонок на узком экране давали ту же кашу из обрезанного
           * текста, что и месяц. В строке ширины хватает на имя клиента,
           * этап и сумму целиком.
           */
          <div className="space-y-2">
            {days.map((d) => {
              const key = dayKey(d);
              const isToday = key === todayKey;
              const orders = ordersByDay.get(key) ?? [];
              const tasks = byDay.get(key) ?? [];
              const calls = callbacksByDay.get(key) ?? [];
              return (
                <div
                  key={key}
                  className={`rounded-2xl border p-2 shadow-card ${
                    isToday
                      ? 'border-brand-300 bg-brand-50/50'
                      : 'border-navy-100 bg-white'
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs font-semibold text-navy-700">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full tabular-nums ${
                          isToday ? 'bg-brand-500 text-white' : 'bg-navy-100'
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      {WEEKDAYS[(d.getDay() + 6) % 7]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setModal({ mode: 'create', date: key })}
                      className="press inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-[11px] font-medium text-navy-600"
                    >
                      <Plus className="h-3 w-3" />
                      задача
                    </button>
                  </div>
                  {orders.length === 0 &&
                  tasks.length === 0 &&
                  calls.length === 0 ? (
                    <p className="px-1 pb-1 text-xs text-navy-600">Дел нет</p>
                  ) : (
                    <div className="space-y-1.5">
                      {calls.map((c) => (
                        <CallbackRow
                          key={c.id}
                          item={c}
                          onOpen={() => navigate(`/clients/${c.id}`)}
                        />
                      ))}
                      {orders.map((o) => (
                        <DayOrderRow
                          key={o.id}
                          order={o}
                          onOpen={() => setOpenOrder(o)}
                        />
                      ))}
                      {tasks.map((t) => (
                        <DayTaskRow
                          key={t.id}
                          task={t}
                          onOpen={() => {
                            if (!isTemp(t.id))
                              setModal({ mode: 'edit', id: t.id });
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Сетка дней — планшет и компьютер */}
        {!isNarrow && (
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {days.map((d) => {
            const key = dayKey(d);
            const inMonth = view === 'week' || d.getMonth() === cursor.getMonth();
            const isToday = key === todayKey;
            const list = byDay.get(key) ?? [];
            return (
              <Droppable key={key} droppableId={key} isDropDisabled={isTouch}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    onClick={(e) => {
                      /*
                       * Нажатие по клетке раскрывает день целиком.
                       *
                       * Раньше срабатывало только по самой рамке: условие
                       * сравнивало цель клика с клеткой, а между карточками,
                       * под ними и на точках срочности лежат вложенные
                       * элементы — по ним не открывалось ничего. Теперь
                       * открываем везде, кроме самих дел: у них свой клик и
                       * они останавливают всплытие.
                       */
                      const el = e.target as HTMLElement;
                      if (el.closest('[data-cal-item]')) return;
                      pickDay(key);
                    }}
                    className={`group flex min-w-0 cursor-pointer flex-col rounded-xl border p-1.5 transition-colors sm:p-2 ${cellMin} ${
                      isToday
                        ? 'border-navy-400 bg-navy-50/60 ring-1 ring-navy-200'
                        : 'border-navy-100 bg-white'
                    } ${
                      /* выбранный день — тот, чей список показан под сеткой */
                      key === selectedDay ? 'ring-2 ring-navy-500' : ''
                    } ${!inMonth ? 'opacity-50' : ''} ${
                      snapshot.isDraggingOver ? 'bg-navy-100/70' : ''
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          pickDay(key);
                        }}
                        className={`press rounded px-1 text-xs font-semibold hover:bg-navy-100 sm:text-sm ${
                          isToday ? 'text-navy-700' : 'text-navy-600'
                        }`}
                        title="Показать все дела этого дня"
                      >
                        {d.getDate()}
                      </button>
                      {/*
                        Точки срочности рядом с числом — те же, что на телефоне.
                        В клетке видны карточки, но их цвет означает ЭТАП
                        заказа, а не «горит ли»: понять, что на день есть
                        просроченная задача, по ним было нельзя.
                      */}
                      {dayDots(key).length > 0 && (
                        <span className="flex shrink-0 items-center gap-[3px]">
                          {dayDots(key).map((c, i) => (
                            <span key={i} className={`h-1.5 w-1.5 rounded-full ${c}`} />
                          ))}
                        </span>
                      )}
                      <div className="flex shrink-0 items-center gap-1">
                        {(ordersByDay.get(key)?.length ?? 0) > 0 && (
                          <span className="rounded-md bg-navy-100 px-1.5 text-[11px] font-semibold text-navy-700">
                            {ordersByDay.get(key)?.length}
                          </span>
                        )}
                        <button
                          data-cal-item
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ mode: 'create', date: key });
                          }}
                          className={`press inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-navy-600 transition hover:bg-navy-100 hover:text-navy-800 sm:px-1.5 ${
                            isTouch ? '' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Plus className="h-3 w-3 shrink-0" />
                          <span className="hidden sm:inline">задача</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 space-y-1.5">
                      {/*
                        Напоминания — фиолетовые, чтобы не путались с
                        оранжевыми перезвонами: перезвон живёт в карточке
                        клиента, напоминание — в разделе «Напоминания», и
                        закрывают их в разных местах.
                      */}
                      {(remindersByDay.get(key) ?? []).map((r) => (
                        <div
                          key={r.id}
                          data-cal-item
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(
                              r.clientId ? `/clients/${r.clientId}` : '/reminders',
                            );
                          }}
                          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-left shadow-card transition-[box-shadow,transform] duration-120 ease-out hover:-translate-y-px hover:shadow-lift"
                          title={`Напоминание: ${r.title}`}
                        >
                          <BellRing className="h-3 w-3 shrink-0 text-violet-600" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-violet-800">
                            {r.client?.fullName ?? r.title}
                          </span>
                        </div>
                      ))}
                      {/* перезвоны первыми: у них назначен час, а не весь день */}
                      {(callbacksByDay.get(key) ?? []).map((c) => (
                        <div
                          key={c.id}
                          data-cal-item
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/clients/${c.id}`);
                          }}
                          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1.5 text-left shadow-card transition-[box-shadow,transform] duration-120 ease-out hover:-translate-y-px hover:shadow-lift"
                          title={`Позвонить ${c.fullName}`}
                        >
                          <Phone className="h-3 w-3 shrink-0 text-orange-600" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-orange-800">
                            {c.fullName}
                          </span>
                        </div>
                      ))}
                      {(ordersByDay.get(key) ?? []).map((o) => (
                          <div
                            key={o.id}
                            data-cal-item
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenOrder(o);
                            }}
                            className="press cursor-pointer"
                          >
                            <OrderCard order={o} compact={view === 'month'} />
                          </div>
                        ))}
                      {list.map((t, index) => (
                        <Draggable
                          key={t.id}
                          draggableId={t.id}
                          index={index}
                          isDragDisabled={isTouch || isTemp(t.id)}
                        >
                          {(p, snap) => (
                            <div
                              ref={p.innerRef}
                              {...p.draggableProps}
                              {...p.dragHandleProps}
                              data-cal-item
                              onClick={(e) => {
                                e.stopPropagation();
                                if (draggingRef.current || isTemp(t.id)) return;
                                setModal({ mode: 'edit', id: t.id });
                              }}
                              /* в руке карточка оторвана от страницы — уровень выпадашки */
                              className={`cursor-pointer ${
                                snap.isDragging ? 'shadow-pop' : ''
                              }`}
                            >
                              <TaskCard task={t} compact={view === 'month'} />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
        )}

        {/*
          Дела выбранного дня — окном по центру экрана.
          Раньше список раскрывался ПОД сеткой и страницу подкручивало вниз.
          На большом экране он уезжал за нижний край: человек нажимал на день
          и не понимал, произошло ли что-нибудь. Окно видно сразу.
        */}
        <Modal
          open={dayOpen && view === 'month'}
          onClose={() => setDayOpen(false)}
          title={
            humanDay(selectedDay) +
            (selectedDay === todayKey ? ' · сегодня' : '')
          }
        >
          {(ordersByDay.get(selectedDay) ?? []).length === 0 &&
          (byDay.get(selectedDay) ?? []).length === 0 &&
          (callbacksByDay.get(selectedDay) ?? []).length === 0 &&
          (remindersByDay.get(selectedDay) ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-navy-200 px-4 py-8 text-center text-sm text-navy-600">
              На этот день дел нет
            </p>
          ) : (
            <div className="space-y-1.5">
              {(remindersByDay.get(selectedDay) ?? []).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setDayOpen(false);
                    navigate(r.clientId ? `/clients/${r.clientId}` : '/reminders');
                  }}
                  className="press flex w-full items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-left"
                >
                  <BellRing className="h-4 w-4 shrink-0 text-violet-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-violet-900">
                      {r.title}
                    </span>
                    <span className="block truncate text-xs text-violet-700">
                      {r.client?.fullName ?? 'Напоминание'}
                      {r.client?.phone ? ` · ${r.client.phone}` : ''}
                    </span>
                  </span>
                </button>
              ))}
              {(callbacksByDay.get(selectedDay) ?? []).map((c) => (
                <CallbackRow
                  key={c.id}
                  item={c}
                  onOpen={() => {
                    setDayOpen(false);
                    navigate(`/clients/${c.id}`);
                  }}
                />
              ))}
              {(ordersByDay.get(selectedDay) ?? []).map((o) => (
                <DayOrderRow
                  key={o.id}
                  order={o}
                  onOpen={() => {
                    setDayOpen(false);
                    setOpenOrder(o);
                  }}
                />
              ))}
              {(byDay.get(selectedDay) ?? []).map((t) => (
                <DayTaskRow
                  key={t.id}
                  task={t}
                  onOpen={() => {
                    if (isTemp(t.id)) return;
                    setDayOpen(false);
                    setModal({ mode: 'edit', id: t.id });
                  }}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setDayOpen(false);
              setModal({ mode: 'create', date: selectedDay });
            }}
            className="btn-ghost mt-3 w-full"
          >
            <Plus className="h-4 w-4" />
            Новая задача на этот день
          </button>
        </Modal>

        {/* Задачи без срока */}
        <Droppable droppableId={NO_DATE} direction="horizontal" isDropDisabled={isTouch}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`mt-4 rounded-2xl border border-dashed p-3 transition-colors ${
                snapshot.isDraggingOver
                  ? 'border-navy-400 bg-navy-100/60'
                  : 'border-navy-200 bg-white'
              }`}
            >
              {/*
                На телефоне блок свёрнут в одну строку со счётчиком: раскрытым
                он занимал полэкрана карточками, до которых почти не доходят.
                На компьютере он как был — там это ещё и место, куда бросают
                задачу, чтобы снять срок.
              */}
              <button
                type="button"
                onClick={() => {
                  if (isNarrow) setUndatedOpen((o) => !o);
                }}
                className="press mb-2 flex w-full items-center gap-1.5 text-left text-xs font-semibold text-navy-600"
              >
                <Inbox className="h-3.5 w-3.5 shrink-0" />
                Без даты
                {ordersUndated.length + undated.length > 0 && (
                  <span>· {ordersUndated.length + undated.length}</span>
                )}
                {isNarrow && (
                  <ChevronDown
                    className={`ml-auto h-4 w-4 shrink-0 transition-transform ${
                      undatedOpen ? 'rotate-180' : ''
                    }`}
                  />
                )}
              </button>
              <div className="flex flex-wrap gap-2">
                {(!isNarrow || undatedOpen) && (
                  <>
                    {ordersUndated.length === 0 && undated.length === 0 && (
                      <span className="text-xs text-navy-600">
                        {isTouch
                          ? 'Заказы и задачи без даты появятся здесь'
                          : 'Перетащите задачу сюда, чтобы снять срок'}
                      </span>
                    )}
                    {ordersUndated.map((o) =>
                      isNarrow ? (
                        <div key={o.id} className="w-full">
                          <DayOrderRow
                            order={o}
                            onOpen={() => setOpenOrder(o)}
                          />
                        </div>
                      ) : (
                        <div
                          key={o.id}
                          onClick={() => setOpenOrder(o)}
                          className="press w-44 cursor-pointer"
                        >
                          <OrderCard order={o} compact />
                        </div>
                      ),
                    )}
                    {undated.map((t, index) => (
                      <Draggable
                        key={t.id}
                        draggableId={t.id}
                        index={index}
                        isDragDisabled={isTouch}
                      >
                        {(p, snap) => (
                          <div
                            ref={p.innerRef}
                            {...p.draggableProps}
                            {...p.dragHandleProps}
                            onClick={() => {
                              if (draggingRef.current || isTemp(t.id)) return;
                              setModal({ mode: 'edit', id: t.id });
                            }}
                            className={`cursor-pointer ${
                              isNarrow ? 'w-full' : 'w-52'
                            } ${snap.isDragging ? 'shadow-pop' : ''}`}
                          >
                            <TaskCard task={t} compact={false} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                  </>
                )}
                {provided.placeholder}
              </div>
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/*
        Легенда — только на планшете и компьютере. На телефоне девять этапов
        занимали три ряда внизу экрана и ничего не добавляли: в списке дня
        этап и так написан словами.
      */}
      <div className="mt-4 hidden flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy-100 bg-white px-4 py-3 shadow-card sm:flex">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-navy-600">Легенда:</span>
          {STAGE_ORDER.map((st) => (
            <span
              key={st}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-600"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${STAGE_DOT[st]}`} />
              {STAGE_LABEL[st]}
            </span>
          ))}
        </div>
        <span className="text-xs text-navy-600">
          {isTouch
            ? 'Нажмите на заказ или задачу, чтобы открыть карточку'
            : 'Нажмите на заказ, чтобы открыть его; задачи перетаскиваются'}
        </span>
      </div>

      {/*
        Загрузка бригад за тот же период, что показан в календаре (ТЗ:
        планирование): сколько людей уже занято в каждый день и куда они едут.
        Так видно, на какой день можно ставить новый объект.
      */}
      <div className="mt-4">
        <BrigadeLoad
          from={dayKey(days[0])}
          to={dayKey(days[days.length - 1])}
        />
      </div>

      <OrderModal
        orderId={openOrder?.id ?? null}
        initial={openOrder ?? undefined}
        onClose={() => setOpenOrder(null)}
        onUpdated={boardQuery.reload}
      />

      {modal && (modal.mode === 'create' || liveTask) && (
        <TaskModal
          key={modal.mode === 'edit' ? modal.id : 'create'}
          mode={modal.mode}
          task={modal.mode === 'edit' ? liveTask : undefined}
          initialDate={modal.mode === 'create' ? modal.date : undefined}
          onClose={() => setModal(null)}
          onCreate={createTask}
          onPatch={patchTask}
          onDeleted={(id) =>
            setData((list) => (list ? list.filter((t) => t.id !== id) : list))
          }
          onReload={reload}
          inFlightRef={inFlightRef}
        />
      )}
    </div>
  );
}
