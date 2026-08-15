import { useState } from 'react';
import { Check, CheckCircle2, ClipboardList, Plus, X } from 'lucide-react';
import { api } from '../api/client';
import { useFetch, deleteRecord, removeFrom } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Badge, EmptyState, ErrorState, Skeleton } from './ui';
import { useDialog } from './Dialog';
import { useToast } from './Toast';
import { formatDateTimeTz } from '../lib/date';
import { isTempId, tempId } from '../lib/util';
import type {
  ChecklistStatus,
  ChecklistTemplate,
  DirtAssessment,
  OrderChecklist,
  OrderChecklistItem,
} from '../types';

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  OPEN: 'Не начат',
  IN_PROGRESS: 'В процессе',
  DONE: 'Закрыт',
};

/** Шкала приёма объекта — цвета повторяют печатную форму */
const LEVELS: { value: DirtAssessment; label: string; on: string; off: string }[] = [
  {
    value: 'NORMAL',
    label: 'Норма',
    on: 'border-emerald-500 bg-emerald-500 text-white',
    off: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
  },
  {
    value: 'MEDIUM',
    label: 'Среднее',
    on: 'border-amber-500 bg-amber-500 text-white',
    off: 'border-amber-200 text-amber-700 hover:bg-amber-50',
  },
  {
    value: 'HEAVY',
    label: 'Сильное',
    on: 'border-red-600 bg-red-600 text-white',
    off: 'border-red-200 text-red-700 hover:bg-red-50',
  },
];

const STATUS_COLOR: Record<ChecklistStatus, string> = {
  OPEN: 'bg-navy-100 text-navy-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  DONE: 'bg-emerald-100 text-emerald-700',
};

/**
 * Пересчёт статуса чек-листа по составу пунктов — зеркало
 * `ChecklistsService.recalcStatus` на бэкенде (checklists.service.ts):
 * ничего не отмечено → OPEN; отмечен хоть один пункт, но есть незакрытые
 * обязательные → IN_PROGRESS; иначе DONE. Закрытый DONE обратно не
 * откатывается — это соответствует серверной логике 1:1.
 */
function recalcStatus(prevStatus: ChecklistStatus, items: OrderChecklistItem[]): ChecklistStatus {
  if (prevStatus === 'DONE') return 'DONE';
  const anyDone = items.some((i) => i.isDone);
  if (!anyDone) return 'OPEN';
  const requiredNotDone = items.some((i) => i.required && !i.isDone);
  return requiredNotDone ? 'IN_PROGRESS' : 'DONE';
}

/** Группировка пунктов по разделу с сохранением порядка их первого появления */
function groupBySection(items: OrderChecklistItem[]) {
  const order: string[] = [];
  const map = new Map<string, OrderChecklistItem[]>();
  for (const item of items) {
    const key = item.section?.trim() || 'Без раздела';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item);
  }
  return order.map((section) => ({ section, items: map.get(section)! }));
}

/**
 * Чек-лист контроля качества конкретного заказа (ТЗ 8). Встраивается в
 * карточку заказа. Если чек-листа ещё нет — предлагает выбрать шаблон,
 * если есть — показывает пункты по разделам с отметкой «кто и когда».
 */
export function OrderChecklistCard({
  orderId,
  canEdit,
}: {
  orderId: string;
  canEdit: boolean;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();

  const {
    data: checklist,
    loading,
    error,
    reload,
    setData,
  } = useFetch<OrderChecklist | null>(
    /*
     * У только что созданного заказа временный номер (temp_…) — на сервере
     * его ещё нет, и запрос дал бы «Не удалось загрузить чек-лист» на
     * рабочей карточке. Ждём настоящий номер: null отключает загрузку.
     */
    isTempId(orderId) ? null : `/orders/${orderId}/checklist`,
  );

  const noChecklistYet = !loading && !error && !checklist;
  const templates = useFetch<ChecklistTemplate[]>(
    noChecklistYet ? '/checklist-templates' : null,
  );

  const [templateId, setTemplateId] = useState('');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemSection, setNewItemSection] = useState('');
  const [newItemRequired, setNewItemRequired] = useState(false);
  const [applying, setApplying] = useState(false);

  /*
   * Пока чек-лист не сохранён на сервере, у его пунктов нет настоящих
   * номеров: показанные — временные, придуманные для мгновенной отрисовки.
   * Нажать «удалить» на таком пункте значило отправить серверу номер,
   * которого он не знает, — отсюда «Пункт чек-листа не найден» сразу после
   * применения шаблона. На эти доли секунды кнопки выключаем.
   */
  const notSavedYet = !!checklist && isTempId(checklist.id);

  const applyTemplate = async () => {
    if (applying) return;
    setApplying(true);
    const chosen = (templates.data ?? []).find((t) => t.id === templateId);
    const id = tempId();
    const optimistic: OrderChecklist = {
      id,
      orderId,
      templateId: chosen?.id ?? null,
      templateName: chosen?.name ?? 'Без шаблона',
      status: 'OPEN',
      items: (chosen?.items ?? []).map((it, i) => ({
        id: `${id}:${i}`,
        title: it.title,
        section: it.section,
        required: it.required,
        sortOrder: i,
        isDone: false,
      })),
    };
    setData(optimistic);
    try {
      const res = await api.post<OrderChecklist>(`/orders/${orderId}/checklist`, {
        templateId: templateId || undefined,
      });
      setData(res.data);
    } catch (e: any) {
      const message = e?.response?.data?.message as string | undefined;
      if (message && /уже есть чек-лист/i.test(message)) {
        /*
         * Чек-лист успели создать в другой вкладке или предыдущим нажатием.
         * Не ругаемся — показываем то, что есть на самом деле.
         */
        setData(null);
        reload();
      } else {
        toast.error(message || 'Не удалось применить шаблон');
        setData(null);
      }
    } finally {
      setApplying(false);
    }
  };

  /** Оценка загрязнения по пункту (чек-лист приёма объекта) */
  const setLevel = async (item: OrderChecklistItem, level: DirtAssessment) => {
    if (!checklist) return;
    // повторный клик по той же оценке снимает её
    const next = item.level === level ? null : level;
    const patch = (fields: Partial<OrderChecklistItem>) =>
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.id === item.id ? { ...i, ...fields } : i,
              ),
            }
          : prev,
      );
    patch({ level: next, isDone: next !== null });
    try {
      await api.patch(
        `/orders/${orderId}/checklist/items/${item.id}`,
        { level: next },
      );
    } catch (e: any) {
      patch({ level: item.level, isDone: item.isDone });
      toast.error(e?.response?.data?.message || 'Не удалось сохранить оценку');
    }
  };

  /** Отметка/снятие отметки — оптимистично, со своим ФИО и временем; откат при ошибке */
  const toggleItem = async (item: OrderChecklistItem) => {
    if (!checklist) return;
    const baseStatus = checklist.status;
    const nextDone = !item.isDone;

    const patchItem = (fields: Partial<OrderChecklistItem>) =>
      setData((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((i) => (i.id === item.id ? { ...i, ...fields } : i));
        return { ...prev, items, status: recalcStatus(baseStatus, items) };
      });

    patchItem({
      isDone: nextDone,
      doneById: nextDone ? user?.id ?? null : null,
      doneByName: nextDone ? user?.fullName ?? null : null,
      doneAt: nextDone ? new Date().toISOString() : null,
    });

    try {
      await api.patch(`/orders/${orderId}/checklist/items/${item.id}`, { isDone: nextDone });
      // тихая сверка: сервер мог автоматически закрыть чек-лист (все
      // обязательные пункты выполнены) — подтягиваем его актуальный статус
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось отметить пункт');
      patchItem({
        isDone: item.isDone,
        doneById: item.doneById,
        doneByName: item.doneByName,
        doneAt: item.doneAt,
      });
    }
  };

  const addCustomItem = async () => {
    if (!checklist) return;
    const title = newItemTitle.trim();
    if (!title) return;
    const baseStatus = checklist.status;
    const localId = tempId();
    const optimisticItem: OrderChecklistItem = {
      id: localId,
      title,
      section: newItemSection.trim() || null,
      required: newItemRequired,
      sortOrder: checklist.items.length,
      isDone: false,
    };
    setData((prev) => {
      if (!prev) return prev;
      const items = [...prev.items, optimisticItem];
      return { ...prev, items, status: recalcStatus(baseStatus, items) };
    });
    setNewItemTitle('');
    setNewItemSection('');
    setNewItemRequired(false);

    try {
      const res = await api.post<OrderChecklistItem>(`/orders/${orderId}/checklist/items`, {
        title,
        section: optimisticItem.section ?? undefined,
        required: newItemRequired,
      });
      setData((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((i) => (i.id === localId ? res.data : i));
        return { ...prev, items, status: recalcStatus(baseStatus, items) };
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось добавить пункт');
      setData((prev) => {
        if (!prev) return prev;
        const items = prev.items.filter((i) => i.id !== localId);
        return { ...prev, items, status: recalcStatus(baseStatus, items) };
      });
    }
  };

  /**
   * Сменить шаблон чек-листа.
   *
   * Нажали «Применить», не выбрав шаблон, — и список остался пустым, а
   * вернуться было некуда: сервер второй раз применять шаблон не даёт («у
   * заказа уже есть чек-лист»), и человек упирался в «Не удалось применить
   * шаблон». Теперь старый чек-лист можно снять и выбрать заново.
   */
  const changeTemplate = async () => {
    if (!checklist) return;
    const filled = checklist.items.filter((i) => i.isDone || i.level).length;
    const ok = await dialog.confirm({
      title: 'Сменить шаблон чек-листа?',
      message: filled
        ? `Нынешний чек-лист «${checklist.templateName}» будет удалён вместе с отметками (их ${filled}). Вернуть их будет нельзя.`
        : `Нынешний чек-лист «${checklist.templateName}» будет удалён, и можно будет выбрать другой шаблон. Отметок в нём нет — терять нечего.`,
      confirmText: 'Сменить шаблон',
      danger: filled > 0,
    });
    if (!ok) return;
    const before = checklist;
    /*
     * Выбор шаблона показываем сразу, но кнопку «Применить» держим
     * выключенной, пока старый чек-лист не удалён на сервере. Иначе новый
     * шаблон уходит раньше удаления, сервер отвечает «у заказа уже есть
     * чек-лист», и человек снова упирается в пустой список.
     */
    setApplying(true);
    setData(null);
    setTemplateId('');
    try {
      // список шаблонов подтянется сам: без чек-листа снова показывается выбор
      await api.delete(`/orders/${orderId}/checklist`);
    } catch (e: any) {
      setData(before);
      toast.error(e?.response?.data?.message || 'Не удалось сменить шаблон');
    } finally {
      setApplying(false);
    }
  };

  const removeItem = async (item: OrderChecklistItem) => {
    if (!checklist) return;
    const ok = await dialog.confirm({
      title: 'Удалить пункт?',
      message: `«${item.title}» будет удалён из чек-листа без возможности восстановления.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    const baseStatus = checklist.status;
    await deleteRecord({
      remove: () =>
        removeFrom(setData, (prev) => {
          if (!prev) return prev;
          const items = prev.items.filter((i) => i.id !== item.id);
          return { ...prev, items, status: recalcStatus(baseStatus, items) };
        }),
      request: () => api.delete(`/orders/${orderId}/checklist/items/${item.id}`),
      onFail: (m) => {
        /*
         * Пункта на сервере уже нет — нажали дважды или его убрал коллега
         * рядом. Пугать нечем: цель достигнута, а список сейчас перечитается
         * и сойдётся сам.
         */
        if (/не найден/i.test(m)) return;
        toast.error(m);
      },
    });
    reload();
  };

  const complete = async () => {
    if (!checklist) return;
    const before = checklist;
    setData((prev) =>
      prev ? { ...prev, status: 'DONE', completedAt: new Date().toISOString() } : prev,
    );
    try {
      const res = await api.post<OrderChecklist>(`/orders/${orderId}/checklist/complete`);
      setData(res.data);
      toast.success('Чек-лист закрыт');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось закрыть чек-лист');
      setData(before);
    }
  };

  const items = checklist?.items ?? [];
  const totalCount = items.length;
  const doneCount = items.filter((i) => i.isDone).length;
  const requiredNotDone = checklist?.items.filter((i) => i.required && !i.isDone).length ?? 0;

  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClipboardList className="h-4 w-4 shrink-0 text-navy-600" />
        <h3 className="font-semibold text-navy-900">Чек-лист качества</h3>
        {checklist && <Badge className={STATUS_COLOR[checklist.status]}>{STATUS_LABEL[checklist.status]}</Badge>}
        {checklist && canEdit && (
          <button
            onClick={changeTemplate}
            disabled={notSavedYet}
            className="press ml-auto shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-50 hover:text-navy-800 disabled:opacity-40"
            title="Снять этот чек-лист и выбрать другой шаблон"
          >
            Сменить шаблон
          </button>
        )}
      </div>

      {error && (
        <ErrorState text="Не удалось загрузить чек-лист заказа" onRetry={reload} />
      )}

      {/*
        Заглушка повторяет будущую разметку: полоса прогресса сверху и
        несколько пунктов. Кружок оставлял пустое место, и при появлении
        данных блок прыгал с нуля на полную высоту.
      */}
      {!error && loading && !checklist && (
        <div className="space-y-4" role="status" aria-label="Загрузка">
          <Skeleton className="h-16 w-full rounded-md" />
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-md" />
            ))}
          </div>
        </div>
      )}

      {!error && noChecklistYet && (
        <div className="space-y-3">
          <p className="text-sm text-navy-600">
            У заказа ещё нет чек-листа контроля качества.
          </p>
          {canEdit ? (
            templates.error ? (
              <ErrorState text="Не удалось загрузить шаблоны" onRetry={templates.reload} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input min-w-[14rem] flex-1"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  disabled={templates.loading && !templates.data}
                >
                  <option value="">Без шаблона (пустой список)</option>
                  {(templates.data ?? [])
                    .filter((t) => t.isActive)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.items.length} пунктов
                      </option>
                    ))}
                </select>
                {/*
                  Пока запрос в пути, кнопка выключена: два нажатия подряд
                  создавали чек-лист дважды, и второй ответ прилетал ошибкой
                  «у заказа уже есть чек-лист».
                */}
                <button
                  onClick={applyTemplate}
                  disabled={applying}
                  className="btn-primary shrink-0 disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  {applying ? 'Применяем…' : 'Применить'}
                </button>
              </div>
            )
          ) : (
            <EmptyState text="Чек-лист по этому заказу пока не создан" />
          )}
        </div>
      )}

      {!error && checklist && (
        <div className="space-y-4">
          {/* Прогресс */}
          <div className="rounded-xl bg-navy-50/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-1 text-sm">
              <span className="font-medium text-navy-800">
                {doneCount} из {totalCount} выполнено
              </span>
              {requiredNotDone > 0 ? (
                <span className="font-medium text-amber-700">
                  Осталось обязательных: {requiredNotDone}
                </span>
              ) : totalCount > 0 ? (
                <span className="font-medium text-emerald-700">Все обязательные выполнены</span>
              ) : null}
            </div>
            {totalCount > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-100">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width] duration-160 ease-out"
                  style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
                />
              </div>
            )}
          </div>

          {/* Пункты по разделам */}
          {totalCount === 0 ? (
            <EmptyState text="Пунктов пока нет — добавьте вручную ниже" />
          ) : (
            <div className="space-y-4">
              {groupBySection(checklist.items).map((group) => (
                <div key={group.section}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-navy-600">
                    {group.section}
                  </div>
                  <div className="space-y-1.5">
                    {group.items.map((item) => (
                      <ChecklistItemRow
                        key={item.id}
                        item={item}
                        // пока чек-лист не сохранён, у пунктов нет настоящих
                        // номеров — трогать их нельзя
                        canEdit={canEdit && !notSavedYet}
                        usesLevels={!!checklist.usesLevels}
                        onToggle={() => toggleItem(item)}
                        onLevel={(lvl) => setLevel(item, lvl)}
                        onRemove={() => removeItem(item)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Добавить свой пункт */}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3">
              <input
                className="input min-w-[10rem] flex-[2]"
                placeholder="Текст нового пункта"
                value={newItemTitle}
                maxLength={300}
                onChange={(e) => setNewItemTitle(e.target.value)}
              />
              <input
                className="input min-w-[8rem] flex-1"
                placeholder="Раздел (необязательно)"
                value={newItemSection}
                maxLength={120}
                onChange={(e) => setNewItemSection(e.target.value)}
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-navy-600">
                <input
                  type="checkbox"
                  checked={newItemRequired}
                  onChange={(e) => setNewItemRequired(e.target.checked)}
                  className="h-4 w-4 accent-navy-500"
                />
                Обязательный
              </label>
              <button
                onClick={addCustomItem}
                disabled={!newItemTitle.trim() || totalCount >= 100}
                className="btn-ghost shrink-0"
              >
                <Plus className="h-4 w-4" />
                Добавить пункт
              </button>
            </div>
          )}

          {/* Закрытие чек-листа */}
          {canEdit && checklist.status !== 'DONE' && (
            <button
              onClick={complete}
              disabled={requiredNotDone > 0 || totalCount === 0}
              className="btn-primary w-full"
              title={
                requiredNotDone > 0
                  ? 'Сначала отметьте все обязательные пункты'
                  : undefined
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              Закрыть чек-лист
            </button>
          )}
          {checklist.status === 'DONE' && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Чек-лист закрыт{checklist.completedAt ? ` · ${formatDateTimeTz(checklist.completedAt)}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistItemRow({
  item,
  canEdit,
  usesLevels,
  onToggle,
  onLevel,
  onRemove,
}: {
  item: OrderChecklistItem;
  canEdit: boolean;
  /** чек-лист приёма объекта: вместо галочки — оценка загрязнения */
  usesLevels: boolean;
  onToggle: () => void;
  onLevel: (level: DirtAssessment) => void;
  onRemove: () => void;
}) {
  const pending = item.required && !item.isDone;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border p-2.5 ${
        pending ? 'border-amber-200 bg-amber-50/40' : 'border-navy-100'
      }`}
    >
      {!usesLevels && (
      <button
        type="button"
        onClick={canEdit ? onToggle : undefined}
        disabled={!canEdit}
        className={`press mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,transform] duration-120 ease-out ${
          item.isDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-navy-300 bg-white'
        } ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
        aria-label={item.isDone ? 'Снять отметку выполнения' : 'Отметить выполненным'}
      >
        {item.isDone && <Check className="h-3.5 w-3.5" />}
      </button>
      )}

      <div className="min-w-0 flex-1">
        <div
          className={`text-sm ${
            !usesLevels && item.isDone
              ? 'text-navy-600 line-through'
              : 'text-navy-900'
          }`}
        >
          {item.title}
          {item.required && (
            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">
              Обязательно
            </span>
          )}
        </div>
        {/* подсказка из бумажной формы: на что смотреть и почему это важно */}
        {item.hint && (
          <div className="mt-0.5 text-xs italic text-navy-600">{item.hint}</div>
        )}
        {usesLevels && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                disabled={!canEdit}
                onClick={() => onLevel(l.value)}
                className={`press rounded-lg border px-2 py-0.5 text-xs font-medium transition-[background-color,border-color,color,transform] duration-120 ease-out ${
                  item.level === l.value ? l.on : `bg-white ${l.off}`
                } ${canEdit ? '' : 'cursor-not-allowed opacity-70'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
        {!usesLevels && item.isDone && item.doneByName && (
          <div className="mt-0.5 text-xs text-navy-600">
            Отметил(а) {item.doneByName}
            {item.doneAt ? ` · ${formatDateTimeTz(item.doneAt)}` : ''}
          </div>
        )}
      </div>

      {canEdit && (
        <button
          onClick={onRemove}
          className="press shrink-0 rounded-lg p-1 text-navy-600 hover:bg-red-50 hover:text-red-600"
          title="Удалить пункт"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
