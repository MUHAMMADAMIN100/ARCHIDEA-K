import { useMemo, useRef, useState } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { ChevronLeft, ChevronRight, Plus, Inbox } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useToast } from '../components/Toast';
import { Spinner, PageHeader, ErrorState, Modal } from '../components/ui';
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
import type { BoardColumn, FunnelStage, Order, Task, TaskType } from '../types';

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

/** Задача ещё не сохранена на сервере (оптимистичная) — действия с ней недоступны */
const isTemp = (id: string) => id.startsWith('temp_');

/** Карточка задачи — на уровне модуля, чтобы не пересоздавалась при обновлениях */
function TaskCard({ task, compact }: { task: Task; compact: boolean }) {
  const done = task.status === 'DONE';
  return (
    <div
      className={`rounded-lg border px-2 py-1.5 text-left transition-shadow hover:shadow-sm ${
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
      className={`rounded-lg border px-2 py-1.5 text-left transition-shadow hover:shadow-sm ${
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

export function Calendar() {
  const toast = useToast();
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
  // какой день раскрыт списком: клик по клетке показывает все дела этого дня
  const [dayOpen, setDayOpen] = useState<string | null>(null);

  /*
   * Заказы берём из той же доски, что и воронка: один запрос, общий кэш —
   * переключение между разделами мгновенное, а этапы гарантированно совпадают.
   */
  const boardQuery = useFetch<BoardColumn[]>('/orders/board', {
    pollMs: 20000,
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
    if (error && !loading) return <ErrorState onRetry={reload} />;
    return <Spinner />;
  }

  // актуальная версия открытой задачи (не снимок на момент клика)
  const liveTask =
    modal?.mode === 'edit' ? data.find((t) => t.id === modal.id) : undefined;

  const cellMin = view === 'week' ? 'min-h-[260px]' : 'min-h-[104px]';

  return (
    <div>
      <PageHeader
        title="Календарь"
        subtitle="Заказы по датам уборки и задачи сотрудников — по этапам воронки"
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
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                view === v
                  ? 'bg-white text-navy-900 shadow-sm'
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
            className="shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 sm:p-2"
            title="Назад"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 whitespace-nowrap text-center text-xs font-bold text-navy-900 sm:min-w-[170px] sm:flex-none sm:text-sm">
            {title}
          </span>
          <button
            onClick={() => shift(1)}
            className="shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 sm:p-2"
            title="Вперёд"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="ml-1 shrink-0 rounded-xl border border-navy-200 px-2 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50 sm:ml-2 sm:px-3 sm:text-sm"
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
            className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:inline-flex ${
              stageFilter === st
                ? 'bg-navy-500 text-white'
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
        {/* Шапка дней недели */}
        <div className="mb-2 grid grid-cols-7 gap-1 sm:gap-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-xs font-semibold text-navy-600">
              {w}
            </div>
          ))}
        </div>

        {/* Сетка дней */}
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
                       * Клик по пустому месту клетки раскрывает день целиком.
                       * По самим карточкам клик обрабатывается отдельно и
                       * сюда не всплывает — иначе открывались бы оба окна.
                       */
                      if (e.target === e.currentTarget) setDayOpen(key);
                    }}
                    className={`group flex min-w-0 cursor-pointer flex-col rounded-xl border p-1.5 transition-colors sm:p-2 ${cellMin} ${
                      isToday
                        ? 'border-navy-400 bg-navy-50/60 ring-1 ring-navy-200'
                        : 'border-navy-100 bg-white'
                    } ${!inMonth ? 'opacity-50' : ''} ${
                      snapshot.isDraggingOver ? 'bg-navy-100/70' : ''
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDayOpen(key);
                        }}
                        className={`rounded px-1 text-xs font-semibold hover:bg-navy-100 sm:text-sm ${
                          isToday ? 'text-navy-700' : 'text-navy-600'
                        }`}
                        title="Показать все дела этого дня"
                      >
                        {d.getDate()}
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {(ordersByDay.get(key)?.length ?? 0) > 0 && (
                          <span className="rounded-md bg-navy-100 px-1.5 text-[11px] font-semibold text-navy-700">
                            {ordersByDay.get(key)?.length}
                          </span>
                        )}
                        <button
                          onClick={() => setModal({ mode: 'create', date: key })}
                          className={`inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-navy-600 transition hover:bg-navy-100 hover:text-navy-800 sm:px-1.5 ${
                            isTouch ? '' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Plus className="h-3 w-3 shrink-0" />
                          <span className="hidden sm:inline">задача</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 space-y-1.5">
                      {(ordersByDay.get(key) ?? []).map((o) => (
                          <div
                            key={o.id}
                            onClick={() => setOpenOrder(o)}
                            className="cursor-pointer"
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
                              onClick={() => {
                                if (draggingRef.current || isTemp(t.id)) return;
                                setModal({ mode: 'edit', id: t.id });
                              }}
                              className={`cursor-pointer ${
                                snap.isDragging ? 'shadow-lg' : ''
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
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-navy-600">
                <Inbox className="h-3.5 w-3.5" />
                Без даты
                {ordersUndated.length + undated.length > 0 && (
                  <span className="text-navy-600">
                    · {ordersUndated.length + undated.length}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {ordersUndated.length === 0 && undated.length === 0 && (
                  <span className="text-xs text-navy-600">
                    {isTouch
                      ? 'Заказы и задачи без даты появятся здесь'
                      : 'Перетащите задачу сюда, чтобы снять срок'}
                  </span>
                )}
                {ordersUndated.map((o) => (
                    <div
                      key={o.id}
                      onClick={() => setOpenOrder(o)}
                      className="w-44 cursor-pointer"
                    >
                      <OrderCard order={o} compact />
                    </div>
                  ))}
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
                        className={`w-52 cursor-pointer ${
                          snap.isDragging ? 'shadow-lg' : ''
                        }`}
                      >
                        <TaskCard task={t} compact={false} />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Легенда */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy-100 bg-white px-4 py-3">
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
            ? '💡 Нажмите на заказ или задачу, чтобы открыть карточку'
            : '💡 Нажмите на заказ, чтобы открыть его; задачи перетаскиваются'}
        </span>
      </div>

      {/*
        Раскрытый день: всё, что на него назначено. В клетке помещаются
        две-три карточки, а дел на день бывает больше — здесь видно всё
        сразу, и отсюда же открывается карточка заказа или задачи.
      */}
      {dayOpen && (
        <Modal
          open
          onClose={() => setDayOpen(null)}
          title={new Date(dayOpen).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        >
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-600">
                Заказы ({(ordersByDay.get(dayOpen) ?? []).length})
              </h4>
              {(ordersByDay.get(dayOpen) ?? []).length === 0 ? (
                <p className="text-sm text-navy-600">На этот день уборок нет</p>
              ) : (
                <div className="space-y-2">
                  {(ordersByDay.get(dayOpen) ?? []).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        setDayOpen(null);
                        setOpenOrder(o);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-navy-100 p-3 text-left transition hover:bg-navy-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-navy-900">
                          {o.client?.fullName ?? 'Клиент'}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-navy-600">
                          {STAGE_LABEL[o.stage]}
                          {o.address ? ` · ${o.address}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-sm font-bold text-navy-800">
                        {formatPrice(orderTotal(o))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-600">
                Задачи ({(byDay.get(dayOpen) ?? []).length})
              </h4>
              {(byDay.get(dayOpen) ?? []).length === 0 ? (
                <p className="text-sm text-navy-600">Задач на этот день нет</p>
              ) : (
                <div className="space-y-2">
                  {(byDay.get(dayOpen) ?? []).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        if (isTemp(t.id)) return;
                        setDayOpen(null);
                        setModal({ mode: 'edit', id: t.id });
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-navy-100 p-3 text-left transition hover:bg-navy-50"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-navy-900">
                        {t.title}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-xs text-navy-600">
                        {TASK_STATUS_LABEL[t.status]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                const date = dayOpen;
                setDayOpen(null);
                setModal({ mode: 'create', date });
              }}
              className="btn-ghost w-full"
            >
              <Plus className="h-4 w-4" />
              Новая задача на этот день
            </button>
          </div>
        </Modal>
      )}

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
