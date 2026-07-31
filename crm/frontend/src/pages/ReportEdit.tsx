import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, Send, Users } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Spinner, PageHeader, EmptyState } from '../components/ui';
import { useToast } from '../components/Toast';
import { PhoneInput } from '../components/ContactFields';
import { DatePicker } from '../components/DatePicker';
import { formatPrice, formatVolume } from '../lib/labels';
import type { Brigade, Cleaner, Order, Report } from '../types';

/** Только цифры, без ведущих нулей */
const digits = (v: string) => v.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
const num = (v: string) => Number(v) || 0;

let rowCounter = 0;
const rowKey = () => `row_${++rowCounter}`;

interface WorkerRow {
  key: string;
  cleanerId: string;
  fullName: string;
  role: string;
  days: string;
  rate: string;
  fine: string;
  extra: string;
}

interface ExpenseRow {
  key: string;
  title: string;
  initiator: string;
  amount: string;
  comment: string;
}

const emptyWorker = (): WorkerRow => ({
  key: rowKey(),
  cleanerId: '',
  fullName: '',
  role: 'Клинер',
  days: '1',
  rate: '230',
  fine: '',
  extra: '',
});

const emptyExpense = (): ExpenseRow => ({
  key: rowKey(),
  title: '',
  initiator: '',
  amount: '',
  comment: '',
});

export function ReportEdit() {
  const { id } = useParams(); // undefined = новый отчёт
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const { data: existing, loading, error } = useFetch<Report>(
    id ? `/reports/${id}` : null,
    { deps: [id] },
  );
  const { data: orders } = useFetch<Order[]>('/orders');
  const { data: cleaners } = useFetch<Cleaner[]>('/cleaners');
  const { data: brigades } = useFetch<Brigade[]>('/brigades');

  // ── поля шапки ──
  const [orderId, setOrderId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [address, setAddress] = useState('');
  const [workDate, setWorkDate] = useState('');
  const [workEndDate, setWorkEndDate] = useState('');
  const [unitsLabel, setUnitsLabel] = useState('');
  const [extraServices, setExtraServices] = useState('');
  const [discount, setDiscount] = useState('');
  const [totalPrice, setTotalPrice] = useState('');
  const [arrivedBy, setArrivedBy] = useState('');
  const [brigadierName, setBrigadierName] = useState('');
  const [managerName, setManagerName] = useState(user?.fullName ?? '');

  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [saving, setSaving] = useState(false);

  // редактирование: заполняем форму один раз из загруженного отчёта
  const seeded = useRef(false);
  useEffect(() => {
    if (!id || !existing || seeded.current) return;
    seeded.current = true;
    if (existing.status === 'ACCEPTED') {
      navigate(`/reports/${existing.id}`, { replace: true });
      return;
    }
    setOrderId(existing.orderId ?? '');
    setClientName(existing.clientName);
    setClientPhone(existing.clientPhone ?? '');
    setAddress(existing.address ?? '');
    setWorkDate(existing.workDate?.slice(0, 10) ?? '');
    setWorkEndDate(existing.workEndDate?.slice(0, 10) ?? '');
    setUnitsLabel(existing.unitsLabel ?? '');
    setExtraServices(existing.extraServices ?? '');
    setDiscount(existing.discount ? String(existing.discount) : '');
    setTotalPrice(existing.totalPrice ? String(existing.totalPrice) : '');
    setArrivedBy(existing.arrivedBy ?? '');
    setBrigadierName(existing.brigadierName ?? '');
    setManagerName(existing.managerName ?? user?.fullName ?? '');
    setWorkers(
      existing.workers.map((w) => ({
        key: rowKey(),
        cleanerId: w.cleanerId ?? '',
        fullName: w.fullName,
        role: w.role,
        days: String(w.days),
        rate: String(w.rate),
        fine: w.fine ? String(w.fine) : '',
        extra: w.extra ? String(w.extra) : '',
      })),
    );
    setExpenses(
      existing.expenses.map((e) => ({
        key: rowKey(),
        title: e.title,
        initiator: e.initiator ?? '',
        amount: String(e.amount),
        comment: e.comment ?? '',
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, id]);

  // бригадиры (для авто-должности)
  const leaderIds = useMemo(
    () => new Set((brigades ?? []).map((b) => b.leaderId).filter(Boolean)),
    [brigades],
  );

  /*
   * Если заказ выбрали раньше, чем догрузился справочник клинеров, ставки
   * в строках работников остаются пустыми. Доставляем их, как только справочник
   * появится — уже введённые вручную значения не трогаем.
   */
  useEffect(() => {
    if (!cleaners?.length) return;
    setWorkers((prev) => {
      if (!prev.some((w) => w.cleanerId && !w.rate)) return prev;
      return prev.map((w) => {
        if (!w.cleanerId || w.rate) return w;
        const full = cleaners.find((c) => c.id === w.cleanerId);
        return full
          ? {
              ...w,
              rate: String(full.rate),
              fullName: w.fullName || full.fullName,
            }
          : w;
      });
    });
  }, [cleaners]);

  const fillFromOrder = (oid: string) => {
    setOrderId(oid);
    const o = (orders ?? []).find((x) => x.id === oid);
    if (!o) return;
    setClientName(o.client?.fullName ?? '');
    setClientPhone(o.client?.phone ?? '');
    setAddress(o.address ?? '');
    if (o.scheduledDate) setWorkDate(o.scheduledDate.slice(0, 10));
    setUnitsLabel(formatVolume(o));
    setTotalPrice(String(o.finalPrice ?? o.estimatedPrice ?? ''));

    /*
     * Ответственный — менеджер ЗАКАЗА, а не тот, кто открыл форму.
     * Раньше поле оставалось со значением текущего пользователя, и в ведомости
     * оказывался не тот человек, который вёл объект.
     */
    setManagerName(o.manager?.fullName ?? '');

    /*
     * Команда заказа переносится в таблицу работников со ставкой и днями.
     * Раньше блок оставался пустым, хотя на заказе были назначены люди —
     * их приходилось выбирать заново вручную.
     */
    const assigned = o.cleaners ?? [];
    if (assigned.length) {
      const known = cleaners ?? [];
      const rows: WorkerRow[] = assigned.map((a) => {
        const full = known.find((c) => c.id === a.id);
        const isLeader = leaderIds.has(a.id);
        return {
          key: rowKey(),
          cleanerId: a.id,
          fullName: a.fullName ?? full?.fullName ?? '',
          role: isLeader ? 'Бригадир' : 'Клинер',
          days: '1',
          rate: String(full?.rate ?? ''),
          fine: '',
          extra: '',
        };
      });
      // бригадир — первой строкой, как на бумажном бланке
      rows.sort((a, b) => (a.role === 'Бригадир' ? -1 : b.role === 'Бригадир' ? 1 : 0));
      setWorkers(rows);

      const leader = assigned.find((a) => leaderIds.has(a.id));
      if (leader) setBrigadierName(leader.fullName);
    }
  };

  const addCleanerRow = (c: Cleaner) => {
    setWorkers((prev) => {
      if (c.id && prev.some((w) => w.cleanerId === c.id)) return prev;
      const isLeader = leaderIds.has(c.id);
      const row: WorkerRow = {
        key: rowKey(),
        cleanerId: c.id,
        fullName: c.fullName,
        role: isLeader ? 'Бригадир' : 'Клинер',
        days: '1',
        rate: String(c.rate),
        fine: '',
        extra: '',
      };
      // бригадир — первым в списке
      return isLeader ? [row, ...prev] : [...prev, row];
    });
    if (leaderIds.has(c.id) && !brigadierName) setBrigadierName(c.fullName);
  };

  const addBrigade = (b: Brigade) => {
    const members = b.cleaners.filter((c) => c.isActive);
    // бригадир первым
    [...members]
      .sort((x, y) => (x.id === b.leaderId ? -1 : y.id === b.leaderId ? 1 : 0))
      .forEach((c) => addCleanerRow(c as Cleaner));
    if (b.leader?.fullName) setBrigadierName(b.leader.fullName);
  };

  const patchWorker = (key: string, patch: Partial<WorkerRow>) =>
    setWorkers((prev) =>
      prev.map((w) => (w.key === key ? { ...w, ...patch } : w)),
    );
  const patchExpense = (key: string, patch: Partial<ExpenseRow>) =>
    setExpenses((prev) =>
      prev.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    );

  const selectCleanerFor = (key: string, cleanerId: string) => {
    const c = (cleaners ?? []).find((x) => x.id === cleanerId);
    if (!c) {
      patchWorker(key, { cleanerId: '' });
      return;
    }
    patchWorker(key, {
      cleanerId: c.id,
      fullName: c.fullName,
      rate: String(c.rate),
      role: leaderIds.has(c.id) ? 'Бригадир' : 'Клинер',
    });
  };

  const workerSum = (w: WorkerRow) =>
    num(w.days) * num(w.rate) - num(w.fine) + num(w.extra);
  const workersSum = workers.reduce((s, w) => s + workerSum(w), 0);
  const expensesSum = expenses.reduce((s, e) => s + num(e.amount), 0);

  const buildPayload = () => ({
    orderId: orderId || null,
    clientName: clientName.trim(),
    clientPhone: clientPhone.trim() || undefined,
    address: address.trim() || undefined,
    workDate: workDate || null,
    workEndDate: workEndDate || null,
    unitsLabel: unitsLabel.trim() || undefined,
    extraServices: extraServices.trim() || undefined,
    discount: num(discount),
    totalPrice: num(totalPrice),
    arrivedBy: arrivedBy.trim() || undefined,
    brigadierName: brigadierName.trim() || undefined,
    managerName: managerName.trim() || undefined,
    workers: workers
      .filter((w) => w.fullName.trim())
      .map((w) => ({
        cleanerId: w.cleanerId || null,
        fullName: w.fullName.trim(),
        role: w.role.trim() || 'Клинер',
        // 0 дней допустимо (работник только со штрафом); максимум 60
        days: Math.min(60, num(w.days)),
        rate: num(w.rate),
        fine: num(w.fine),
        extra: num(w.extra),
      })),
    expenses: expenses
      .filter((e) => e.title.trim() && num(e.amount) > 0)
      .map((e) => ({
        title: e.title.trim(),
        initiator: e.initiator.trim() || undefined,
        amount: num(e.amount),
        comment: e.comment.trim() || undefined,
      })),
  });

  const save = async (andSend: boolean) => {
    if (!clientName.trim()) {
      toast.error('Укажите клиента / объект');
      return;
    }
    setSaving(true);
    let saved: Report | null = null;
    try {
      const payload = buildPayload();
      saved = id
        ? (await api.patch<Report>(`/reports/${id}`, payload)).data
        : (await api.post<Report>('/reports', payload)).data;
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить отчёт');
      setSaving(false);
      return; // ничего не сохранилось — остаёмся в форме
    }
    // отчёт сохранён; сбой отправки не должен приводить к дублям —
    // уходим на страницу отчёта, откуда его можно отправить повторно
    try {
      if (andSend && saved.status === 'DRAFT') {
        await api.post(`/reports/${saved.id}/send`);
        toast.success('Отчёт отправлен основателю');
      } else {
        toast.success('Отчёт сохранён');
      }
    } catch {
      toast.error(
        'Черновик сохранён, но не отправлен — отправьте его со страницы отчёта',
      );
    }
    navigate(`/reports/${saved.id}`, { replace: true });
  };

  if (id && !existing) {
    if (error && !loading) {
      return (
        <div className="mx-auto max-w-4xl">
          <button
            onClick={() => navigate('/reports')}
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-800"
          >
            <ArrowLeft className="h-4 w-4" /> К списку
          </button>
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        </div>
      );
    }
    return <Spinner />;
  }

  const activeOrders = (orders ?? []).filter(
    (o) => o.stage !== 'REJECTED',
  );

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-800"
      >
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>

      <PageHeader
        title={id ? 'Редактирование отчёта' : 'Новый отчёт'}
        subtitle="Платёжная ведомость по объекту — отправляется основателю"
      />

      {/* ── Объект ── */}
      <div className="card mb-5 p-5">
        <h3 className="mb-4 font-bold text-navy-900">Объект</h3>

        <div className="mb-4">
          <label className="label">Заполнить из заказа (необязательно)</label>
          <select
            className="input"
            value={orderId}
            onChange={(e) => fillFromOrder(e.target.value)}
          >
            <option value="">— выбрать заказ из воронки —</option>
            {activeOrders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.client?.fullName} · {formatVolume(o)} ·{' '}
                {(o.finalPrice ?? o.estimatedPrice).toLocaleString('ru-RU')} с
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Клиент / объект *</label>
            <input
              className="input"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Например: Галина"
            />
          </div>
          <PhoneInput value={clientPhone} onChange={setClientPhone} />
          <div className="sm:col-span-2">
            <label className="label">Адрес</label>
            <input
              className="input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Адрес объекта"
            />
          </div>
          <div>
            <label className="label">Дата начала работ</label>
            <DatePicker value={workDate} onChange={setWorkDate} />
          </div>
          <div>
            <label className="label">Дата завершения (если не в один день)</label>
            <DatePicker value={workEndDate} onChange={setWorkEndDate} />
          </div>
          <div>
            <label className="label">Площадь и стоимость за единицу</label>
            <input
              className="input"
              value={unitsLabel}
              onChange={(e) => setUnitsLabel(e.target.value)}
              placeholder="Например: 180 м² по 25 с"
            />
          </div>
          <div>
            <label className="label">Доп. услуга и стоимость на единицу</label>
            <input
              className="input"
              value={extraServices}
              onChange={(e) => setExtraServices(e.target.value)}
              placeholder="Например: мытьё окон, 6 шт по 50 с"
            />
          </div>
          <div>
            <label className="label">Предоставленная скидка, сомони</label>
            <input
              type="text"
              inputMode="numeric"
              className="input"
              value={discount}
              onChange={(e) => setDiscount(digits(e.target.value))}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">Итоговая стоимость, сомони *</label>
            <input
              type="text"
              inputMode="numeric"
              className="input font-bold"
              value={totalPrice}
              onChange={(e) => setTotalPrice(digits(e.target.value))}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">Прибыл(а)</label>
            <input
              className="input"
              value={arrivedBy}
              onChange={(e) => setArrivedBy(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Ответственный бригадир</label>
            <input
              className="input"
              value={brigadierName}
              onChange={(e) => setBrigadierName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Ответственный менеджер</label>
            <input
              className="input"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Работники ── */}
      <div className="card mb-5 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-navy-900">Работники</h3>
          <div className="flex flex-wrap gap-2">
            {(brigades ?? []).map((b) => (
              <button
                key={b.id}
                onClick={() => addBrigade(b)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
              >
                <Users className="h-3.5 w-3.5" />
                {b.name}
              </button>
            ))}
            <button
              onClick={() => setWorkers((p) => [...p, emptyWorker()])}
              className="inline-flex items-center gap-1.5 rounded-xl border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Работник
            </button>
          </div>
        </div>

        {workers.length === 0 ? (
          <EmptyState text="Добавьте бригаду целиком или работников по одному" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-600">
                  <th className="py-2 pr-2 font-semibold">Сотрудник</th>
                  <th className="w-28 py-2 pr-2 font-semibold">Должность</th>
                  <th className="w-16 py-2 pr-2 font-semibold">Дней</th>
                  <th className="w-20 py-2 pr-2 font-semibold">Ставка</th>
                  <th className="w-20 py-2 pr-2 font-semibold">Штраф</th>
                  <th className="w-20 py-2 pr-2 font-semibold">Доп.</th>
                  <th className="w-24 py-2 pr-2 text-right font-semibold">Сумма</th>
                  <th className="w-10 py-2" />
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.key} className="border-b border-navy-50 align-middle">
                    <td className="py-2 pr-2">
                      <select
                        className="input !py-1.5"
                        value={w.cleanerId}
                        onChange={(e) => selectCleanerFor(w.key, e.target.value)}
                      >
                        <option value="">— вручную —</option>
                        {(cleaners ?? [])
                          .filter(
                            (c) =>
                              // отключённый клинер остаётся видимым в своей строке
                              (c.isActive || c.id === w.cleanerId) &&
                              !workers.some(
                                (x) => x.cleanerId === c.id && x.key !== w.key,
                              ),
                          )
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.fullName}
                              {c.brigade ? ` · ${c.brigade.name}` : ''}
                              {!c.isActive ? ' · отключён' : ''}
                            </option>
                          ))}
                      </select>
                      {!w.cleanerId && (
                        <input
                          className="input mt-1 !py-1.5"
                          value={w.fullName}
                          onChange={(e) =>
                            patchWorker(w.key, { fullName: e.target.value })
                          }
                          placeholder="ФИО"
                        />
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="input !py-1.5"
                        value={w.role}
                        onChange={(e) => patchWorker(w.key, { role: e.target.value })}
                      >
                        <option value="Бригадир">Бригадир</option>
                        <option value="Клинер">Клинер</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={w.days}
                        onChange={(e) =>
                          patchWorker(w.key, { days: digits(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={w.rate}
                        onChange={(e) =>
                          patchWorker(w.key, { rate: digits(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={w.fine}
                        onChange={(e) =>
                          patchWorker(w.key, { fine: digits(e.target.value) })
                        }
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={w.extra}
                        onChange={(e) =>
                          patchWorker(w.key, { extra: digits(e.target.value) })
                        }
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 pr-2 text-right font-bold text-navy-900">
                      {workerSum(w).toLocaleString('ru-RU')}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() =>
                          setWorkers((p) => p.filter((x) => x.key !== w.key))
                        }
                        className="rounded-lg p-1.5 text-navy-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-navy-900">
                  <td className="py-2.5" colSpan={6}>
                    Итого выплаты работникам
                  </td>
                  <td className="py-2.5 pr-2 text-right">
                    {formatPrice(workersSum)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Доп. расходы ── */}
      <div className="card mb-5 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-navy-900">Доп. расходы</h3>
          <button
            onClick={() => setExpenses((p) => [...p, emptyExpense()])}
            className="inline-flex items-center gap-1.5 rounded-xl border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Расход
          </button>
        </div>

        {expenses.length === 0 ? (
          <p className="text-sm text-navy-600">
            Расходов нет. Например: такси, расходные материалы, обед бригады.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-600">
                  <th className="py-2 pr-2 font-semibold">Наименование</th>
                  <th className="w-36 py-2 pr-2 font-semibold">Инициатор</th>
                  <th className="w-24 py-2 pr-2 font-semibold">Сумма</th>
                  <th className="py-2 pr-2 font-semibold">Комментарий</th>
                  <th className="w-10 py-2" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.key} className="border-b border-navy-50">
                    <td className="py-2 pr-2">
                      <input
                        className="input !py-1.5"
                        value={e.title}
                        onChange={(ev) =>
                          patchExpense(e.key, { title: ev.target.value })
                        }
                        placeholder="Например: такси"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="input !py-1.5"
                        value={e.initiator}
                        onChange={(ev) =>
                          patchExpense(e.key, { initiator: ev.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={e.amount}
                        onChange={(ev) =>
                          patchExpense(e.key, { amount: digits(ev.target.value) })
                        }
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="input !py-1.5"
                        value={e.comment}
                        onChange={(ev) =>
                          patchExpense(e.key, { comment: ev.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() =>
                          setExpenses((p) => p.filter((x) => x.key !== e.key))
                        }
                        className="rounded-lg p-1.5 text-navy-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-navy-900">
                  <td className="py-2.5" colSpan={2}>
                    Итого расходов
                  </td>
                  <td className="py-2.5 pr-2">{formatPrice(expensesSum)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Итоги и действия ── */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="text-sm text-navy-600">
          Выручка: <b className="text-navy-900">{formatPrice(num(totalPrice))}</b>
          {' · '}Выплаты: <b className="text-navy-900">{formatPrice(workersSum)}</b>
          {' · '}Расходы: <b className="text-navy-900">{formatPrice(expensesSum)}</b>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="btn-ghost"
          >
            <Save className="h-4 w-4" />
            Сохранить черновик
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="btn-primary"
          >
            <Send className="h-4 w-4" />
            {saving ? 'Сохранение…' : 'Отправить основателю'}
          </button>
        </div>
      </div>
    </div>
  );
}
