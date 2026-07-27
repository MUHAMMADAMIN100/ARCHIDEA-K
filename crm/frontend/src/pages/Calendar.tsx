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
import { Spinner, PageHeader, ErrorState } from '../components/ui';
import { TaskModal } from '../components/TaskModal';
import {
  TASK_TYPE_COLOR,
  TASK_TYPE_DOT,
  TASK_TYPE_LABEL,
  TASK_TYPE_ORDER,
  TASK_STATUS_LABEL,
} from '../lib/labels';
import { tempId, nowISO } from '../lib/util';
import { useAuth } from '../auth/AuthContext';
import type { Task, TaskType } from '../types';

type View = 'month' | 'week';

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
  const [typeFilter, setTypeFilter] = useState<TaskType | 'ALL'>('ALL');
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
      if (typeFilter !== 'ALL' && t.type !== typeFilter) continue;
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
  }, [data, typeFilter]);

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
        subtitle="Задачи сотрудников по дням — постановка, сроки и статусы"
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
                  : 'text-navy-500 hover:text-navy-800'
              }`}
            >
              {v === 'month' ? 'Месяц' : 'Неделя'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => shift(-1)}
            className="rounded-lg p-2 text-navy-500 hover:bg-navy-50"
            title="Назад"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[170px] text-center text-sm font-bold text-navy-900">
            {title}
          </span>
          <button
            onClick={() => shift(1)}
            className="rounded-lg p-2 text-navy-500 hover:bg-navy-50"
            title="Вперёд"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="ml-2 rounded-xl border border-navy-200 px-3 py-1.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            Сегодня
          </button>
        </div>
      </div>

      {/* Фильтр по типу */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-navy-400">Тип:</span>
        {(['ALL', ...TASK_TYPE_ORDER] as (TaskType | 'ALL')[]).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              typeFilter === t
                ? 'bg-navy-500 text-white'
                : 'bg-navy-100 text-navy-600 hover:bg-navy-200'
            }`}
          >
            {t !== 'ALL' && (
              <span
                className={`h-2 w-2 rounded-full ${
                  typeFilter === t ? 'bg-white' : TASK_TYPE_DOT[t]
                }`}
              />
            )}
            {t === 'ALL' ? 'Все' : TASK_TYPE_LABEL[t]}
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
        <div className="mb-2 grid grid-cols-7 gap-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-xs font-semibold text-navy-400">
              {w}
            </div>
          ))}
        </div>

        {/* Сетка дней */}
        <div className="grid grid-cols-7 gap-2">
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
                    className={`group flex flex-col rounded-xl border p-2 transition-colors ${cellMin} ${
                      isToday
                        ? 'border-navy-400 bg-navy-50/60 ring-1 ring-navy-200'
                        : 'border-navy-100 bg-white'
                    } ${!inMonth ? 'opacity-50' : ''} ${
                      snapshot.isDraggingOver ? 'bg-navy-100/70' : ''
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span
                        className={`text-sm font-semibold ${
                          isToday ? 'text-navy-700' : 'text-navy-500'
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      <button
                        onClick={() => setModal({ mode: 'create', date: key })}
                        className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-navy-500 transition hover:bg-navy-100 hover:text-navy-800 ${
                          isTouch ? '' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <Plus className="h-3 w-3" />
                        задача
                      </button>
                    </div>

                    <div className="flex-1 space-y-1.5">
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
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-navy-400">
                <Inbox className="h-3.5 w-3.5" />
                Без срока
                {undated.length > 0 && (
                  <span className="text-navy-500">· {undated.length}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {undated.length === 0 && (
                  <span className="text-xs text-navy-300">
                    {isTouch
                      ? 'Задачи без даты появятся здесь'
                      : 'Перетащите сюда, чтобы снять срок'}
                  </span>
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
          <span className="text-xs font-semibold text-navy-400">Легенда:</span>
          {TASK_TYPE_ORDER.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-600"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${TASK_TYPE_DOT[t]}`} />
              {TASK_TYPE_LABEL[t]}
            </span>
          ))}
        </div>
        <span className="text-xs text-navy-400">
          {isTouch
            ? '💡 Нажмите на задачу, чтобы изменить дату и статусы'
            : '💡 Задачи можно перетаскивать на другой день'}
        </span>
      </div>

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
