import { useEffect, useState, type MutableRefObject } from 'react';
import { Trash2, Users } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { ClientPicker } from './ClientPicker';
import { useAuth } from '../auth/AuthContext';
import { userManagesTasks } from '../types';
import { Modal } from './ui';
import { useToast } from './Toast';
import { useDialog } from './Dialog';
import { DatePicker } from './DatePicker';
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  TASK_STATUS_COLOR,
  TASK_STATUS_LABEL,
  TASK_TYPE_DOT,
  TASK_TYPE_LABEL,
  TASK_TYPE_ORDER,
} from '../lib/labels';
import type { Task, TaskPriority, TaskStatus, TaskType } from '../types';

interface Person {
  id: string;
  fullName: string;
  position?: string | null;
}

const STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE'];

/** «2026-07-27T12:00:00.000Z» → «2026-07-27» (по локальной дате) */
function toDayInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Создание и редактирование задачи календаря.
 * Все изменения применяются мгновенно (оптимистично), запрос уходит в фон.
 */
export function TaskModal({
  mode,
  task,
  initialDate,
  onClose,
  onCreate,
  onPatch,
  onDeleted,
  onReload,
  inFlightRef,
}: {
  mode: 'create' | 'edit';
  task?: Task;
  initialDate?: string | null;
  onClose: () => void;
  onCreate: (
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
  ) => void;
  onPatch: (id: string, patch: Partial<Task>) => void;
  onDeleted: (id: string) => void;
  onReload: () => void;
  inFlightRef: MutableRefObject<number>;
}) {
  const toast = useToast();
  const dialog = useDialog();
  const { user } = useAuth();
  const { data: people } = useFetch<Person[]>('/users/assignable');

  /*
   * Кто вправе править и удалять эту задачу.
   *
   * Сотрудник без доступа к задачам компании ведёт только те, что поставил
   * себе сам. Раньше кнопки «Удалить» и «Сохранить» показывались всем: человек
   * нажимал, задача исчезала из списка, затем сервер отвечал отказом, и она
   * возвращалась — на вид «то работает, то нет». В списке задач эта проверка
   * уже была, а в карточке терялась.
   */
  const canEdit =
    mode === 'create' ||
    userManagesTasks(user) ||
    (!!task &&
      task.creatorId === user?.id &&
      task.assignments.every((a) => a.userId === user?.id));

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [type, setType] = useState<TaskType>(task?.type ?? 'CALL');
  const [priority, setPriority] = useState<TaskPriority>(
    task?.priority ?? 'MEDIUM',
  );
  const [day, setDay] = useState(
    mode === 'edit' ? toDayInput(task?.deadline) : (initialDate ?? ''),
  );
  // клиент, к которому относится задача — необязателен
  const [clientId, setClientId] = useState<string | null>(task?.clientId ?? null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assignments.map((a) => a.userId) ?? [],
  );

  /*
   * Сотрудник без доступа к задачам компании ставит их только себе, и бэкенд
   * отдаёт ему список из одной строки — его самого. Отмечаем её сразу: иначе
   * человек жмёт «Создать» и получает «Выберите хотя бы одного исполнителя»
   * при единственном возможном выборе.
   */
  useEffect(() => {
    if (mode !== 'create') return;
    if (assigneeIds.length > 0) return;
    if (people?.length === 1) setAssigneeIds([people[0].id]);
  }, [mode, people, assigneeIds.length]);

  const toggleAssignee = (id: string) =>
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  /**
   * Список для выбора: активные сотрудники + уже назначенные, даже если их
   * отключили. Без этого уволенного исполнителя нельзя было бы снять
   * с задачи (его нет в /users/assignable), и задача не сохранялась бы.
   */
  const options: (Person & { inactive?: boolean })[] = [
    ...(people ?? []),
    ...(task?.assignments ?? [])
      .filter((a) => !(people ?? []).some((p) => p.id === a.userId))
      .map((a) => ({
        id: a.userId,
        fullName: a.user.fullName,
        position: 'отключён',
        inactive: true,
      })),
  ];

  /** Запрос в фоне со счётчиком — на время запроса поллинг на паузе */
  const background = (p: Promise<unknown>, errText: string) => {
    inFlightRef.current += 1;
    p.catch((e: any) => {
      toast.error(e?.response?.data?.message || errText);
      onReload();
    }).finally(() => {
      inFlightRef.current -= 1;
    });
  };

  const submitCreate = () => {
    const chosen = options.filter((p) => assigneeIds.includes(p.id));
    onCreate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        priority,
        deadline: day || null,
        assigneeIds,
        clientId,
      },
      chosen.map((p) => ({ id: p.id, fullName: p.fullName })),
    );
    onClose();
  };

  const submitEdit = () => {
    if (!task) return;
    const chosen = options.filter((p) => assigneeIds.includes(p.id));
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      type,
      priority,
      deadline: day || null,
      assigneeIds,
      clientId,
    };
    // оптимистично: карточка в календаре обновляется сразу
    onPatch(task.id, {
      title: payload.title,
      description: payload.description ?? undefined,
      type,
      priority,
      deadline: day ? `${day}T12:00:00.000Z` : null,
      assignments: chosen.map((p) => {
        const existing = task.assignments.find((a) => a.userId === p.id);
        return (
          existing ?? {
            id: `${task.id}:${p.id}`,
            userId: p.id,
            status: 'OPEN' as TaskStatus,
            user: { id: p.id, fullName: p.fullName },
          }
        );
      }),
    });
    background(
      api.patch(`/tasks/${task.id}`, payload).then(() => onReload()),
      'Не удалось сохранить задачу',
    );
    toast.success('Сохранено');
    onClose();
  };

  /** Смена статуса конкретного исполнителя (руководитель) */
  const setAssigneeStatus = (userId: string, status: TaskStatus) => {
    if (!task) return;
    const next = task.assignments.map((a) =>
      a.userId === userId ? { ...a, status } : a,
    );
    const statuses = next.map((a) => a.status);
    const aggregate: TaskStatus = statuses.every((s) => s === 'DONE')
      ? 'DONE'
      : statuses.every((s) => s === 'OPEN')
        ? 'OPEN'
        : 'IN_PROGRESS';
    onPatch(task.id, { assignments: next, status: aggregate });
    background(
      api.patch(`/tasks/${task.id}/status`, { status, userId }),
      'Не удалось изменить статус',
    );
  };

  const removeTask = async () => {
    if (!task) return;
    const ok = await dialog.confirm({
      title: 'Удалить задачу?',
      message: `«${task.title}» будет удалена у всех исполнителей.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    onDeleted(task.id);
    onClose();
    // через background(): на время запроса поллинг на паузе, иначе фоновое
    // обновление успело бы вернуть уже удалённую задачу обратно в календарь
    background(api.delete(`/tasks/${task.id}`), 'Не удалось удалить задачу');
  };

  const canSubmit = title.trim().length > 0 && assigneeIds.length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Новая задача' : 'Задача'}
    >
      <div className="space-y-3">
        <div>
          <label className="label">Название *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Например: обзвонить клиентов по акции"
          />
        </div>

        <div>
          <label className="label">Описание</label>
          <textarea
            className="input min-h-[70px] resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </div>

        <div>
          <label className="label">Тип</label>
          <div className="flex flex-wrap gap-1.5">
            {TASK_TYPE_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-sm font-medium transition ${
                  type === t
                    ? 'border-navy-500 bg-navy-50 text-navy-900'
                    : 'border-navy-200 text-navy-600 hover:bg-navy-50'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${TASK_TYPE_DOT[t]}`} />
                {TASK_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        {/*
          Клиент задачи. Встречу и звонок назначают по конкретному человеку,
          и перед выездом нужны его телефон и адрес — здесь они и появятся.
        */}
        <div>
          <label className="label">Клиент</label>
          <ClientPicker value={clientId} onChange={(id) => setClientId(id)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Приоритет</label>
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Дата</label>
            <DatePicker value={day} onChange={setDay} placeholder="без срока" />
          </div>
        </div>

        <div>
          <label className="label">
            Исполнители * {assigneeIds.length > 0 && `· выбрано ${assigneeIds.length}`}
          </label>
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-navy-200 p-1.5">
            {options.length === 0 && (
              <div className="px-2 py-3 text-sm text-navy-600">
                Загрузка сотрудников…
              </div>
            )}
            {options.map((p) => {
              const on = assigneeIds.includes(p.id);
              const assignment = task?.assignments.find((a) => a.userId === p.id);
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition ${
                    on ? 'bg-navy-50' : 'hover:bg-navy-50/60'
                  }`}
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleAssignee(p.id)}
                      className="h-4 w-4 shrink-0 accent-navy-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-navy-900">
                        {p.fullName}
                      </span>
                      {p.position && (
                        <span className="block truncate text-xs text-navy-600">
                          {p.position}
                        </span>
                      )}
                    </span>
                  </label>

                  {/* статус исполнителя — только в режиме редактирования */}
                  {mode === 'edit' && assignment && (
                    <select
                      value={assignment.status}
                      onChange={(e) =>
                        setAssigneeStatus(p.id, e.target.value as TaskStatus)
                      }
                      className={`shrink-0 rounded-lg border-0 px-2 py-1 text-xs font-semibold ${
                        TASK_STATUS_COLOR[assignment.status]
                      }`}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          {mode === 'edit' && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-navy-600">
              <Users className="h-3 w-3" />
              Статус меняет исполнитель у себя — здесь видно, кто на каком этапе
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          {mode === 'edit' && canEdit ? (
            <button
              onClick={removeTask}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Удалить
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">
              {canEdit ? 'Отмена' : 'Закрыть'}
            </button>
            {canEdit && (
              <button
                onClick={mode === 'create' ? submitCreate : submitEdit}
                disabled={!canSubmit}
                className="btn-primary"
              >
                {mode === 'create' ? 'Поставить задачу' : 'Сохранить'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
