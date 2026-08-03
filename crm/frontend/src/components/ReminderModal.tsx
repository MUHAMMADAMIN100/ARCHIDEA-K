import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { ClientPicker } from './ClientPicker';
import { Modal } from './ui';
import { useToast } from './Toast';
import { UserPicker } from './common';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';
import { toDateTimeInput } from '../lib/date';
import { userSeesAll } from '../types';
import type { Client, Reminder } from '../types';

/**
 * Быстрые интервалы предзаказа (ТЗ 10.1): менеджер выбирает промежуток,
 * через который система сама напомнит перезвонить клиенту.
 * Значения — целые дни, как их ждёт CreateReminderDto.intervalDays.
 */
/** Время, которое подставляется, если человек выбрал только дату */
const DEFAULT_TIME = '09:00';

/** Сегодняшний день «ГГГГ-ММ-ДД» — на случай, если выбрали только время */
const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

const QUICK_INTERVALS: { label: string; days: number }[] = [
  { label: 'через неделю', days: 7 },
  { label: 'через 2 недели', days: 14 },
  { label: 'через месяц', days: 30 },
  { label: 'через 3 месяца', days: 90 },
  { label: 'через полгода', days: 180 },
];

interface ReminderModalProps {
  open: boolean;
  onClose: () => void;
  /** Клиент, для которого ставится напоминание — обязателен в режиме создания */
  clientId?: string;
  /** Имя клиента, если уже известно вызывающей карточке — иначе подтянем сами */
  clientName?: string;
  orderId?: string | null;
  /** Если передано — модалка работает в режиме правки существующего напоминания */
  reminder?: Reminder;
  onSaved?: (reminder: Reminder) => void;
}

/**
 * Постановка и правка напоминания перезвонить клиенту (ТЗ 10.1).
 * Используется и как самостоятельная форма из карточки клиента/заказа
 * (создание), и из раздела «Напоминания» (правка существующего).
 */
export function ReminderModal({
  open,
  onClose,
  clientId,
  clientName,
  orderId,
  reminder,
  onSaved,
}: ReminderModalProps) {
  const { user } = useAuth();
  const toast = useToast();
  const canAssign = userSeesAll(user);
  const isEdit = !!reminder;

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'interval' | 'custom'>('custom');
  const [intervalDays, setIntervalDays] = useState<number | null>(null);
  const [customAt, setCustomAt] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /*
   * Клиент, выбранный прямо в окне.
   *
   * Из карточки клиента он известен и приходит пропсом. Из раздела
   * «Напоминания» напоминание ставят «в воздухе» — там его надо выбрать:
   * без телефона под рукой напоминание перезвонить бесполезно.
   */
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);

  // Компонент может оставаться смонтированным между открытиями (карточка
  // клиента/заказа переиспользует его) — поэтому поля заполняем заново
  // каждый раз при открытии, а не только один раз через useState().
  useEffect(() => {
    if (!open) return;
    setTitle(reminder?.title ?? '');
    setNote(reminder?.note ?? '');
    setMode('custom');
    setIntervalDays(null);
    setCustomAt(reminder ? toDateTimeInput(reminder.remindAt) : '');
    setAssigneeId(reminder?.assigneeId ?? null);
    setPickedId(null);
    setPickedName(null);
  }, [open, reminder]);

  // Если имя клиента не передали явно — подтягиваем карточку клиента,
  // чтобы менеджер видел, кому именно ставит напоминание.
  const targetClientId = reminder?.clientId ?? clientId ?? pickedId ?? undefined;
  const { data: fetchedClient } = useFetch<Client>(
    open && !clientName && targetClientId ? `/clients/${targetClientId}` : null,
  );
  const displayName =
    clientName ?? pickedName ?? fetchedClient?.fullName ?? 'не выбран';
  /** Клиента выбирают в самом окне только там, где он неизвестен */
  const needsPick = !isEdit && !clientId;

  // «2026-08-07T09:00» → части для календаря и списка времени
  const customDate = customAt.slice(0, 10);
  const customTime = customAt.slice(11, 16);

  const canSubmit =
    (!needsPick || !!pickedId) &&
    title.trim().length > 0 &&
    (mode === 'interval' ? !!intervalDays : !!customAt) &&
    !saving;

  const pickInterval = (days: number) => {
    setIntervalDays(days);
    setMode('interval');
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      note: note.trim() || undefined,
    };
    if (mode === 'interval') payload.intervalDays = intervalDays;
    else payload.remindAt = customAt;
    if (canAssign && assigneeId) payload.assigneeId = assigneeId;

    /*
     * Окно закрывается сразу, запрос уходит фоном: ждать сеть, чтобы
     * увидеть закрытое окно, незачем. Если сервер откажет — скажем об этом
     * сообщением, напоминание просто не появится в списке.
     */
    onClose();
    toast.success(isEdit ? 'Напоминание поставлено' : 'Напоминание поставлено');
    try {
      let saved: Reminder;
      if (isEdit && reminder) {
        saved = (await api.patch<Reminder>(`/reminders/${reminder.id}`, payload))
          .data;
      } else {
        const target = clientId ?? pickedId;
        if (!target) throw new Error('Не выбран клиент для напоминания');
        saved = (
          await api.post<Reminder>('/reminders', {
            ...payload,
            clientId: target,
            orderId: orderId ?? undefined,
          })
        ).data;
      }
      onSaved?.(saved);
    } catch (e: any) {
      toast.error(
        e?.response?.data?.message || 'Не удалось сохранить напоминание',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Напоминание' : 'Напомнить о звонке'}>
      <div className="space-y-3">
        {needsPick ? (
          <div>
            <label className="label">Клиент *</label>
            <ClientPicker
              value={pickedId}
              onChange={(id, c) => {
                setPickedId(id);
                setPickedName(c?.fullName ?? null);
              }}
              placeholder="Найдите клиента по имени или телефону"
            />
          </div>
        ) : (
        <div className="rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2 text-sm text-navy-600">
          Клиент: <span className="font-medium text-navy-900">{displayName}</span>
        </div>
        )}

        <div>
          <label className="label">Заголовок *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Например: перезвонить насчёт повторной уборки"
          />
        </div>

        <div>
          <label className="label">Комментарий</label>
          <textarea
            className="input min-h-[70px] resize-none"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="Что важно не забыть при звонке"
          />
        </div>

        {isEdit && reminder?.status === 'DONE' && (
          <p className="text-xs text-amber-600">
            Изменение времени вернёт выполненное напоминание в очередь.
          </p>
        )}

        <div>
          <label className="label">Когда напомнить</label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_INTERVALS.map((q) => (
              <button
                key={q.days}
                type="button"
                onClick={() => pickInterval(q.days)}
                className={`press rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                  mode === 'interval' && intervalDays === q.days
                    ? 'border-brand-400 bg-brand-50 text-brand-800'
                    : 'border-navy-200 text-navy-600 hover:bg-navy-50'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
          {/*
            Дата и время раздельно.
            Одно системное поле datetime-local показывало время в формате
            языка браузера — у части сотрудников с «AM/PM». Теперь дата
            выбирается нашим календарём, время — нашим списком, и выглядит
            это одинаково на любом устройстве.
          */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="w-[9.5rem]">
              <DatePicker
                value={customDate}
                onChange={(v) => {
                  setCustomAt(v ? `${v}T${customTime || DEFAULT_TIME}` : '');
                  setMode('custom');
                }}
                placeholder="дд.мм.гггг"
              />
            </div>
            <TimePicker
              className="w-[7.5rem]"
              value={customTime}
              onChange={(v) => {
                setCustomAt(`${customDate || todayKey()}T${v || DEFAULT_TIME}`);
                setMode('custom');
              }}
              ariaLabel="Время напоминания"
            />
            <span className="text-xs text-navy-600">своя дата и время</span>
          </div>
        </div>

        {canAssign && (
          <div>
            <label className="label">Исполнитель</label>
            <UserPicker value={assigneeId} onChange={setAssigneeId} placeholder="Я сам(а)" />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button onClick={submit} disabled={!canSubmit} className="btn-primary">
            {saving ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Поставить напоминание'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
