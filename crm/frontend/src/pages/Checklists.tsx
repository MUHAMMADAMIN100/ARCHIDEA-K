import { useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Badge, Modal, PageHeader } from '../components/ui';
import { DataTable, type Column } from '../components/common';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { ACTIVE_TYPES, TYPE_LABEL } from '../lib/labels';
import { tempId } from '../lib/util';
import { userManagesCatalogs } from '../types';
import type { ChecklistTemplate, CleaningType } from '../types';

/** Пункт шаблона в редакторе — с локальным устойчивым ключом для React и переупорядочивания */
interface EditableItem {
  uid: string;
  title: string;
  /** пояснение под пунктом — на что смотреть и почему это важно */
  hint: string;
  section: string;
  required: boolean;
}

/** То, что уходит на бэкенд при создании/правке шаблона */
interface TemplatePayload {
  name: string;
  cleaningType: CleaningType | null;
  isActive: boolean;
  /** пункты оцениваются «норма / среднее / сильное» вместо галочки */
  usesLevels: boolean;
  description: string | null;
  items: {
    title: string;
    hint: string | null;
    section: string | null;
    required: boolean;
  }[];
}

const MAX_ITEMS = 100;

/**
 * Шаблоны чек-листов контроля качества (ТЗ 8). Смотреть и править может любой
 * сотрудник компании — это рабочий инструмент бригад, а не деньги
 * (совпадает с бэкендовым правом `checklists:manage`).
 */
export function Checklists() {
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const canManage = userManagesCatalogs(user);

  const { data, loading, error, reload, setData } = useFetch<ChecklistTemplate[]>(
    '/checklist-templates',
  );
  const [modalTemplate, setModalTemplate] = useState<ChecklistTemplate | 'new' | null>(
    null,
  );

  const createTemplate = async (payload: TemplatePayload) => {
    const id = tempId();
    const optimistic: ChecklistTemplate = {
      id,
      name: payload.name,
      cleaningType: payload.cleaningType,
      isActive: payload.isActive,
      items: payload.items.map((it, i) => ({
        id: `${id}:${i}`,
        title: it.title,
        hint: it.hint,
        section: it.section,
        required: it.required,
        sortOrder: i,
      })),
    };
    setData((list) => (list ? [optimistic, ...list] : [optimistic]));
    setModalTemplate(null);
    try {
      await api.post('/checklist-templates', payload);
      toast.success('Шаблон создан');
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось создать шаблон');
      setData((list) => (list ? list.filter((t) => t.id !== id) : list));
    }
  };

  const updateTemplate = async (existing: ChecklistTemplate, payload: TemplatePayload) => {
    setData((list) =>
      list
        ? list.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  name: payload.name,
                  cleaningType: payload.cleaningType,
                  isActive: payload.isActive,
                  items: payload.items.map((it, i) => ({
                    id: `${existing.id}:${i}`,
                    title: it.title,
                    hint: it.hint,
                    section: it.section,
                    required: it.required,
                    sortOrder: i,
                  })),
                }
              : t,
          )
        : list,
    );
    setModalTemplate(null);
    try {
      await api.patch(`/checklist-templates/${existing.id}`, payload);
      toast.success('Шаблон обновлён');
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить шаблон');
      reload(); // состав пунктов при правке — полная замена, точечный откат ненадёжен
    }
  };

  const removeTemplate = async (t: ChecklistTemplate) => {
    const ok = await dialog.confirm({
      title: 'Удалить шаблон?',
      message: `«${t.name}» переместится в корзину и пропадёт из выбора для новых заказов. Уже применённые к заказам чек-листы не изменятся.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setData((list) => (list ? list.filter((x) => x.id !== t.id) : list));
    try {
      await api.delete(`/checklist-templates/${t.id}`);
      toast.success('Шаблон перемещён в корзину');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить шаблон');
      reload();
    }
  };

  const columns: Column<ChecklistTemplate>[] = [
    {
      key: 'name',
      title: 'Шаблон',
      render: (t) => (
        <div>
          <div className="font-medium text-navy-900">{t.name}</div>
          {!t.isActive && (
            <div className="text-xs text-navy-600">Отключён — не предлагается в заказах</div>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      title: 'Вид уборки',
      hideOnMobile: true,
      render: (t) => (t.cleaningType ? TYPE_LABEL[t.cleaningType] : 'Любой вид уборки'),
    },
    {
      key: 'items',
      title: 'Пунктов',
      numeric: true,
      render: (t) => String(t.items.length),
    },
    {
      key: 'status',
      title: 'Статус',
      render: (t) => (
        <Badge
          className={
            t.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-navy-100 text-navy-600'
          }
        >
          {t.isActive ? 'Активен' : 'Отключён'}
        </Badge>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            title: '',
            render: (t: ChecklistTemplate) => (
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => setModalTemplate(t)}
                  className="rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 hover:text-navy-700"
                  title="Редактировать"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => removeTemplate(t)}
                  className="rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                  title="Удалить"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } as Column<ChecklistTemplate>,
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Чек-листы"
        subtitle="Шаблоны контроля качества уборки. Правка шаблона не меняет уже применённые к заказам чек-листы — изменения касаются только новых"
        action={
          canManage && (
            <button onClick={() => setModalTemplate('new')} className="btn-primary">
              <Plus className="h-4 w-4" />
              Новый шаблон
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={data}
        rowKey={(t) => t.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyText={
          canManage
            ? 'Шаблонов чек-листов пока нет. Создайте первый, чтобы бригадиры и менеджеры отмечали контроль качества прямо в заказе.'
            : 'Шаблонов чек-листов пока нет.'
        }
      />

      {modalTemplate && canManage && (
        <TemplateModal
          template={modalTemplate === 'new' ? null : modalTemplate}
          onClose={() => setModalTemplate(null)}
          onSubmit={(payload) =>
            modalTemplate === 'new'
              ? createTemplate(payload)
              : updateTemplate(modalTemplate, payload)
          }
        />
      )}
    </div>
  );
}

/** Создание/правка шаблона: название, вид уборки, пункты с переупорядочиванием */
function TemplateModal({
  template,
  onClose,
  onSubmit,
}: {
  template: ChecklistTemplate | null;
  onClose: () => void;
  onSubmit: (payload: TemplatePayload) => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [cleaningType, setCleaningType] = useState<CleaningType | ''>(
    template?.cleaningType ?? '',
  );
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  // шкала «норма / среднее / сильное» вместо галочки — для чек-листов приёма
  const [usesLevels, setUsesLevels] = useState(template?.usesLevels ?? false);
  const [description, setDescription] = useState(template?.description ?? '');
  const [items, setItems] = useState<EditableItem[]>(
    () =>
      template?.items.map((it) => ({
        uid: it.id,
        title: it.title,
        hint: it.hint ?? '',
        section: it.section ?? '',
        required: it.required,
      })) ?? [],
  );

  const updateItem = (uid: string, patch: Partial<EditableItem>) =>
    setItems((list) => list.map((i) => (i.uid === uid ? { ...i, ...patch } : i)));

  const addItem = () =>
    setItems((list) =>
      list.length >= MAX_ITEMS
        ? list
        : [...list, { uid: tempId(), title: '', hint: '', section: '', required: false }],
    );

  const removeItem = (uid: string) =>
    setItems((list) => list.filter((i) => i.uid !== uid));

  // кнопки вверх/вниз — надёжнее drag-and-drop на телефоне бригадира
  const move = (index: number, dir: -1 | 1) =>
    setItems((list) => {
      const to = index + dir;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const canSubmit = name.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      cleaningType: cleaningType || null,
      isActive,
      usesLevels,
      description: description.trim() || null,
      // пустые строки-заготовки без текста в шаблон не попадают
      items: items
        .filter((i) => i.title.trim().length > 0)
        .map((i) => ({
          title: i.title.trim(),
          hint: i.hint.trim() || null,
          section: i.section.trim() || null,
          required: i.required,
        })),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={template ? 'Редактирование шаблона' : 'Новый шаблон чек-листа'}
      wide
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Название *</label>
            <input
              className="input"
              value={name}
              maxLength={200}
              placeholder="Например: Генеральная уборка"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Вид уборки</label>
            <select
              className="input"
              value={cleaningType}
              onChange={(e) => setCleaningType(e.target.value as CleaningType | '')}
            >
              <option value="">Любой вид уборки</option>
              {ACTIVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2.5">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-navy-500"
          />
          <span className="text-sm font-medium text-navy-800">
            Активен — предлагается при выборе шаблона в заказе
          </span>
        </label>

        {/*
          Два разных вида чек-листа: приём объекта до работ оценивается по
          шкале загрязнения, контроль качества после работ — галочкой.
        */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2.5">
          <input
            type="checkbox"
            checked={usesLevels}
            onChange={(e) => setUsesLevels(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-navy-500"
          />
          <span className="text-sm text-navy-800">
            <span className="font-medium">Оценка загрязнения вместо галочки</span>
            <span className="mt-0.5 block text-xs text-navy-600">
              Каждый пункт отмечается как «Норма», «Среднее» или «Сильное» —
              для чек-листов приёма объекта до начала работ.
            </span>
          </span>
        </label>

        <div>
          <label className="label">Пояснение к чек-листу</label>
          <input
            className="input"
            value={description}
            maxLength={300}
            placeholder="Например: приём объекта менеджером до начала работ"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Пункты чек-листа</label>
            <span className="text-xs text-navy-600">{items.length} / {MAX_ITEMS}</span>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-navy-200 bg-white/60 py-6 text-center text-sm text-navy-600">
              Пунктов пока нет — добавьте первый ниже
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((it, index) => (
                <div
                  key={it.uid}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-navy-100 p-2.5 sm:flex-nowrap"
                >
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="rounded p-0.5 text-navy-600 hover:bg-navy-50 hover:text-navy-700 disabled:opacity-30"
                      aria-label="Переместить выше"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === items.length - 1}
                      className="rounded p-0.5 text-navy-600 hover:bg-navy-50 hover:text-navy-700 disabled:opacity-30"
                      aria-label="Переместить ниже"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <input
                    className="input min-w-[10rem] flex-[2]"
                    value={it.title}
                    maxLength={300}
                    placeholder="Текст пункта — например «Помыть окна»"
                    onChange={(e) => updateItem(it.uid, { title: e.target.value })}
                  />
                  <input
                    className="input min-w-[8rem] flex-1"
                    value={it.section}
                    maxLength={120}
                    placeholder="Раздел (Кухня, Санузел…)"
                    onChange={(e) => updateItem(it.uid, { section: e.target.value })}
                  />
                  {/* подсказка — та самая строка курсивом из бумажной формы */}
                  <input
                    className="input min-w-[10rem] flex-[2]"
                    value={it.hint}
                    maxLength={300}
                    placeholder="Подсказка — на что смотреть"
                    onChange={(e) => updateItem(it.uid, { hint: e.target.value })}
                  />

                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-navy-600">
                    <input
                      type="checkbox"
                      checked={it.required}
                      onChange={(e) => updateItem(it.uid, { required: e.target.checked })}
                      className="h-4 w-4 accent-navy-500"
                    />
                    Обязательный
                  </label>

                  <button
                    type="button"
                    onClick={() => removeItem(it.uid)}
                    className="shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                    title="Удалить пункт"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={addItem}
            disabled={items.length >= MAX_ITEMS}
            className="btn-ghost mt-3 w-full"
          >
            <Plus className="h-4 w-4" />
            Добавить пункт
          </button>
        </div>

        {/* пара равных кнопок: на телефоне во всю ширину, на десктопе справа */}
        <div className="grid grid-cols-2 gap-2 border-t border-navy-100 pt-3 sm:flex sm:justify-end">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button onClick={submit} disabled={!canSubmit} className="btn-primary">
            <ClipboardList className="h-4 w-4" />
            {template ? 'Сохранить' : 'Создать шаблон'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
