import { useRef, useState } from 'react';
import { Plus, Trash2, CalendarDays } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Spinner, PageHeader, Badge, EmptyState } from '../components/ui';
import { useToast } from '../components/Toast';
import { TaskModal } from '../components/TaskModal';
import {
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  TASK_STATUS_COLOR,
  TASK_STATUS_LABEL,
  TASK_TYPE_DOT,
  TASK_TYPE_LABEL,
  formatDate,
} from '../lib/labels';
import { formatPhone } from '../lib/contact';
import { tempId, nowISO, withRetry } from '../lib/util';
import { userManagesTasks } from '../types';
import type { Task, TaskPriority, TaskStatus, TaskType } from '../types';

const STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE'];

/** Сводный статус по статусам исполнителей */
function aggregate(statuses: TaskStatus[]): TaskStatus {
  if (statuses.length === 0) return 'OPEN';
  if (statuses.every((s) => s === 'DONE')) return 'DONE';
  if (statuses.every((s) => s === 'OPEN')) return 'OPEN';
  return 'IN_PROGRESS';
}

export function Tasks() {
  const { user } = useAuth();
  const toast = useToast();
  // задачи ставит директор ИЛИ ops-менеджер (расширенный доступ)
  /*
   * ТЗ 1.2: полный доступ к задачам определяется правом на модуль задач,
   * а не признаком «видит всю компанию». Иначе Ирода видела бы все задачи,
   * но не могла ни поставить, ни назначить, ни удалить ни одной.
   */
  const canAssign = userManagesTasks(user);
  /*
   * Завести задачу может каждый — но сотрудник без доступа к задачам компании
   * только САМОМУ СЕБЕ (список исполнителей ему бэкенд отдаёт из одной строки).
   * Без этого календарь и раздел задач для него — экран «только чтение»,
   * в который нельзя записать ни звонок, ни выезд.
   */
  const isOwnPersonalTask = (t: Task) =>
    t.creatorId === user?.id &&
    t.assignments.every((a) => a.userId === user?.id);
  const inFlightRef = useRef(0);
  const { data, loading, reload, setData } = useFetch<Task[]>('/tasks', {
    pollMs: 20000,
    pollPaused: () => inFlightRef.current > 0,
  });
  const [showAdd, setShowAdd] = useState(false);
  // задача, открытая по клику на карточку
  const [editTask, setEditTask] = useState<Task | null>(null);

  const patchTask = (id: string, patch: Partial<Task>) =>
    setData((tasks) =>
      tasks ? tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) : tasks,
    );

  /** Смена статуса исполнителя — мгновенно, запрос в фоне */
  const setStatus = async (task: Task, userId: string, status: TaskStatus) => {
    const before = task.assignments.find((a) => a.userId === userId)?.status;
    // точечное обновление: не трогаем статусы других исполнителей,
    // чтобы параллельные изменения не затирали друг друга
    const apply = (value: TaskStatus) =>
      setData((tasks) =>
        tasks
          ? tasks.map((t) => {
              if (t.id !== task.id) return t;
              const assignments = t.assignments.map((a) =>
                a.userId === userId ? { ...a, status: value } : a,
              );
              return {
                ...t,
                assignments,
                status: aggregate(assignments.map((a) => a.status)),
              };
            })
          : tasks,
      );

    apply(status);
    inFlightRef.current += 1;
    try {
      await api.patch(`/tasks/${task.id}/status`, { status, userId });
    } catch {
      toast.error('Не удалось изменить статус задачи');
      if (before) apply(before); // откат только своего исполнителя
      reload();
    } finally {
      inFlightRef.current -= 1;
    }
  };

  // оптимистично: убираем задачу сразу (с повтором при разовом сбое)
  const remove = async (id: string) => {
    setData((tasks) => (tasks ? tasks.filter((t) => t.id !== id) : tasks));
    try {
      await withRetry(() => api.delete(`/tasks/${id}`));
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить задачу');
      reload();
    }
  };

  // оптимистично: задача появляется в списке сразу
  const createTask = (
    payload: {
      title: string;
      description?: string;
      type: TaskType;
      priority: TaskPriority;
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
    setData((t) => (t ? [optimistic, ...t] : [optimistic]));
    api
      .post('/tasks', payload)
      .then(() => reload())
      .catch((e) => {
        toast.error(e?.response?.data?.message || 'Не удалось создать задачу');
        setData((t) => (t ? t.filter((x) => x.id !== id) : t));
      });
  };

  return (
    <div>
      <PageHeader
        title="Задачи"
        action={
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="h-4 w-4" />
            Новая задача
          </button>
        }
      />

      {loading || !data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState text="Задач нет" />
      ) : (
        <div className="space-y-3">
          {data.map((t) => {
            // менеджер управляет только своим статусом, руководитель — любым
            const visible = canAssign
              ? t.assignments
              : t.assignments.filter((a) => a.userId === user?.id);
            return (
              // карточка кликабельна: открывает задачу целиком — срок, тип,
              // приоритет, все исполнители и их статусы можно менять на месте
              <div
                key={t.id}
                onClick={() => setEditTask(t)}
                title="Открыть задачу"
                className="card cursor-pointer p-4 transition-shadow hover:shadow-lg"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${TASK_TYPE_DOT[t.type]}`}
                        title={TASK_TYPE_LABEL[t.type]}
                      />
                      <span className="font-semibold text-navy-900">{t.title}</span>
                      <Badge className={PRIORITY_COLOR[t.priority]}>
                        {PRIORITY_LABEL[t.priority]}
                      </Badge>
                      <Badge className={TASK_STATUS_COLOR[t.status]}>
                        {TASK_STATUS_LABEL[t.status]}
                      </Badge>
                    </div>
                    {t.description && (
                      <p className="mt-1 text-sm text-navy-600">{t.description}</p>
                    )}
                    {/*
                      Клиент задачи с телефоном и адресом: перед выездом на
                      встречу их не приходится искать в другом разделе.
                    */}
                    {t.client && (
                      <div className="mt-1.5 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-navy-100 bg-navy-50/60 px-2 py-1 text-xs">
                        <span className="font-semibold text-navy-900">
                          {t.client.fullName}
                        </span>
                        <a
                          href={`tel:+992${t.client.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-brand-600 hover:underline"
                        >
                          {formatPhone(t.client.phone)}
                        </a>
                        {t.client.orders?.[0]?.address && (
                          <span className="text-navy-600">
                            · {t.client.orders[0].address}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy-600">
                      <span>{TASK_TYPE_LABEL[t.type]}</span>
                      {t.deadline && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {formatDate(t.deadline)}
                        </span>
                      )}
                      {canAssign && <span>Поставил: {t.creator.fullName}</span>}
                    </div>
                  </div>

                  {(canAssign || isOwnPersonalTask(t)) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(t.id);
                      }}
                      className="rounded-lg p-2 text-navy-600 hover:bg-red-50 hover:text-red-600"
                      title="Удалить задачу"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Исполнители и их статусы — селекты не должны открывать карточку */}
                <div
                  className="mt-3 flex flex-wrap gap-2 border-t border-navy-50 pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {visible.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 rounded-xl border border-navy-100 px-2.5 py-1.5"
                    >
                      <span className="text-sm font-medium text-navy-800">
                        {a.user.fullName}
                      </span>
                      <select
                        value={a.status}
                        onChange={(e) =>
                          setStatus(t, a.userId, e.target.value as TaskStatus)
                        }
                        className={`rounded-lg border-0 px-2 py-1 text-xs font-semibold ${
                          TASK_STATUS_COLOR[a.status]
                        }`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {TASK_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <TaskModal
          mode="create"
          onClose={() => setShowAdd(false)}
          onCreate={createTask}
          onPatch={patchTask}
          onDeleted={(id) =>
            setData((tasks) => (tasks ? tasks.filter((t) => t.id !== id) : tasks))
          }
          onReload={reload}
          inFlightRef={inFlightRef}
        />
      )}

      {/*
       * Берём задачу из свежего списка, а не из состояния: пока модалка открыта,
       * поллинг обновляет статусы, и снимок в стейте успел бы устареть.
       */}
      {editTask && (
        <TaskModal
          key={editTask.id}
          mode="edit"
          task={(data ?? []).find((t) => t.id === editTask.id) ?? editTask}
          onClose={() => setEditTask(null)}
          onCreate={createTask}
          onPatch={patchTask}
          onDeleted={(id) => {
            setData((tasks) => (tasks ? tasks.filter((t) => t.id !== id) : tasks));
            setEditTask(null);
          }}
          onReload={reload}
          inFlightRef={inFlightRef}
        />
      )}
    </div>
  );
}
