import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { api } from '../api/client';
import { deleteRecord } from '../api/hooks';
import { useToast } from './Toast';
import { useDialog } from './Dialog';
import { formatPrice } from '../lib/labels';
import { formatDateTz } from '../lib/date';
import type { OrderPayment, PaymentBank, PaymentMethod } from '../types';

/**
 * Оплаты по заказу (ТЗ 3.1 и 3.2).
 *
 * Раньше оплата была одним числом «Оплатил клиент»: система знала сумму, но
 * не знала, чем заплатили и сколькими частями. Теперь каждый взнос — строка
 * со способом, банком и датой, а «смешанная оплата» это несколько строк,
 * внесённых одним действием.
 *
 * Взносы сохраняются сразу, отдельным запросом, а не вместе с заказом:
 * деньги — отдельное событие, и терять их из-за неудачного сохранения формы
 * заказа нельзя.
 */

type Mode = 'CASH' | 'BANK' | 'MIXED';

interface PartRow {
  /** локальный ключ строки — нужен только React'у */
  key: string;
  amount: string;
  method: PaymentMethod;
  bankId: string;
}

interface Props {
  orderId: string;
  /** Взносы, пришедшие вместе с заказом */
  payments: OrderPayment[];
  /** Полная сумма заказа — от неё считается остаток */
  total: number;
  /** Можно ли править: у закрытых/чужих заказов блок только для чтения */
  readOnly?: boolean;
  /** Заказ изменился — перезагрузить карточку и доску */
  onChanged: () => void;
}

let bankCache: PaymentBank[] | null = null;

function newRow(method: PaymentMethod = 'CASH'): PartRow {
  return {
    key: Math.random().toString(36).slice(2),
    amount: '',
    method,
    bankId: '',
  };
}

export function paymentChannel(p: {
  method: PaymentMethod | null;
  bank?: { title: string } | null;
}): string {
  if (!p.method) return 'способ не указан';
  if (p.method === 'CASH') return 'Наличные';
  return p.bank?.title ?? 'Безналичный расчёт';
}

export function OrderPayments({
  orderId,
  payments,
  total,
  readOnly,
  onChanged,
}: Props) {
  const toast = useToast();
  const dialog = useDialog();

  const [banks, setBanks] = useState<PaymentBank[]>(bankCache ?? []);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('CASH');
  const [amount, setAmount] = useState('');
  const [bankId, setBankId] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<PartRow[]>([newRow('CASH'), newRow('BANK')]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  /*
   * Справочник банков грузится один раз на вкладку: он маленький и меняется
   * раз в год, а запрашивать его при каждом открытии карточки — лишняя
   * задержка перед вводом суммы.
   */
  useEffect(() => {
    if (bankCache) return;
    api
      .get<PaymentBank[]>('/banks')
      .then((r) => {
        bankCache = r.data;
        setBanks(r.data);
      })
      .catch(() => {});
  }, []);

  const paid = useMemo(
    () => payments.reduce((sum, p) => sum + p.amount, 0),
    [payments],
  );
  const due = Math.max(0, total - paid);

  const amountN = Math.max(0, Math.round(Number(amount) || 0));
  const partsSum = rows.reduce(
    (sum, r) => sum + Math.max(0, Math.round(Number(r.amount) || 0)),
    0,
  );
  const declared = mode === 'MIXED' ? amountN : amountN;
  // при смешанной оплате сумма частей обязана совпасть с суммой платежа (ТЗ 3.2)
  const mismatch = mode === 'MIXED' && declared > 0 && partsSum !== declared;

  function reset() {
    setOpen(false);
    setMode('CASH');
    setAmount('');
    setBankId('');
    setNote('');
    setRows([newRow('CASH'), newRow('BANK')]);
  }

  /** Ошибка, из-за которой платёж нельзя провести. null — можно */
  function problem(): string | null {
    if (declared <= 0) return 'Укажите сумму платежа';
    if (declared > due)
      return `Переплата: по заказу осталось внести ${formatPrice(due)}`;
    if (mode === 'BANK' && !bankId) return 'Выберите банк';
    if (mode === 'MIXED') {
      if (partsSum !== declared)
        return `Сумма частей ${formatPrice(partsSum)} не совпадает с суммой платежа ${formatPrice(declared)}`;
      for (const r of rows) {
        const value = Math.round(Number(r.amount) || 0);
        if (value <= 0) continue;
        if (r.method === 'BANK' && !r.bankId)
          return 'В части с безналичным расчётом выберите банк';
      }
      if (!rows.some((r) => Math.round(Number(r.amount) || 0) > 0))
        return 'Заполните хотя бы одну часть';
    }
    return null;
  }

  async function save() {
    const err = problem();
    if (err) {
      toast.error(err);
      return;
    }
    const parts =
      mode === 'MIXED'
        ? rows
            .map((r) => ({
              amount: Math.round(Number(r.amount) || 0),
              method: r.method,
              ...(r.method === 'BANK' ? { bankId: r.bankId } : {}),
            }))
            .filter((p) => p.amount > 0)
        : [
            {
              amount: declared,
              method: mode as PaymentMethod,
              ...(mode === 'BANK' ? { bankId } : {}),
            },
          ];

    setSaving(true);
    try {
      await api.post(`/orders/${orderId}/payments`, {
        parts: note.trim()
          ? parts.map((p) => ({ ...p, note: note.trim() }))
          : parts,
        expectedTotal: declared,
      });
      reset();
      onChanged();
      toast.success('Оплата внесена');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось внести оплату');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: OrderPayment) {
    const ok = await dialog.confirm({
      title: 'Удалить взнос?',
      message: `${formatPrice(p.amount)} — ${paymentChannel(p)}. Доход по нему тоже будет снят.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setBusyId(p.id);
    await deleteRecord({
      remove: () => undefined,
      request: () => api.delete(`/orders/${orderId}/payments/${p.id}`),
      onDone: () => {
        toast.success('Взнос удалён');
        onChanged();
      },
      onFail: (m) => toast.error(m),
    });
    setBusyId(null);
  }

  return (
    <div className="rounded-xl border border-navy-100 bg-white p-3" data-testid="payments-block">
      {/*
        Шапка блока: подпись слева, суммы справа — строго в одну линию.

        Раньше справа стояли ДВЕ суммы с валютой: «4 000 сомони из 3 970
        сомони». В узкой карточке они не помещались, переносились, и подпись
        «ОПЛАТЫ» съезжала вверх, наезжая на цифру. Слово «сомони» нужно один
        раз — валюта у обеих сумм одна и та же; whitespace-nowrap не даёт
        разорвать сумму посреди числа, а min-w-0 с truncate у подписи
        отдаёт цифрам всё нужное место на самых узких экранах.
      */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-navy-600">
          Оплаты
        </div>
        <div className="shrink-0 whitespace-nowrap text-[13px] font-semibold tabular-nums text-navy-900">
          {paid.toLocaleString('ru-RU')}
          {total > 0 && (
            <span className="font-normal text-navy-500">
              {' '}
              из {total.toLocaleString('ru-RU')}
            </span>
          )}
          <span className="ml-1 text-xs font-normal text-navy-500">сомони</span>
        </div>
      </div>

      {payments.length > 0 && (
        <ul className="mt-2 space-y-1">
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-navy-50 px-2 py-1.5 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-navy-900">
                  {formatPrice(p.amount)}
                  <span className="ml-1 font-normal text-navy-600">
                    — {paymentChannel(p)}
                  </span>
                </div>
                <div className="truncate text-xs text-navy-500">
                  {formatDateTz(p.paidAt)}
                  {p.createdByName ? ` · ${p.createdByName}` : ''}
                  {p.note ? ` · ${p.note}` : ''}
                </div>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  aria-label="Удалить взнос"
                  className="shrink-0 rounded-lg p-1 text-navy-400 hover:bg-red-50 hover:text-red-600"
                  disabled={busyId === p.id}
                  onClick={() => remove(p)}
                >
                  {busyId === p.id ? (
                    <span className="block h-[15px] w-[15px] animate-spin rounded-full border-2 border-navy-200 border-t-navy-600" />
                  ) : (
                    <Trash2 size={15} />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {payments.length === 0 && (
        <p className="mt-2 text-sm text-navy-500">Оплат ещё не было</p>
      )}

      {/*
        Переплата не должна прятаться. Внести её система не даёт, но она может
        достаться от прежнего учёта или появиться, если сумму заказа потом
        уменьшили. Молчать об этом нельзя: остаток показал бы ноль, и лишние
        деньги на руках у компании никто бы не заметил.
      */}
      {paid > total && total > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-sm font-medium text-amber-800">
          Оплачено больше суммы заказа на {formatPrice(paid - total)} — проверьте
          взносы или сумму заказа
        </p>
      )}

      {!readOnly && due > 0 && !open && (
        <button
          type="button"
          data-testid="payment-open"
          className="btn-ghost mt-2 w-full justify-center text-sm"
          onClick={() => {
            setOpen(true);
            setAmount(String(due));
          }}
        >
          <Plus size={15} /> Внести оплату
        </button>
      )}

      {!readOnly && due === 0 && total > 0 && payments.length > 0 && (
        <p className="mt-2 text-center text-sm font-medium text-emerald-700">
          Заказ оплачен полностью
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-3 rounded-xl border border-navy-100 bg-navy-50/60 p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-navy-900">Новая оплата</div>
            <button
              type="button"
              aria-label="Отменить"
              className="rounded-lg p-1 text-navy-400 hover:bg-white hover:text-navy-700"
              onClick={reset}
            >
              <X size={16} />
            </button>
          </div>

          <div>
            <label className="label">Сумма платежа, сомони</label>
            <input
              type="number"
              min={1}
              className="input"
              data-testid="payment-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
            <p className="mt-1 text-xs text-navy-500">
              Осталось внести {formatPrice(due)}
            </p>
          </div>

          {/* Способ оплаты — прямо как в ТЗ: наличные, безналичный, смешанная */}
          <div>
            <label className="label">Способ оплаты</label>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1">
              {(
                [
                  ['CASH', 'Наличные'],
                  ['BANK', 'Банк'],
                  ['MIXED', 'Смешанная'],
                ] as [Mode, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`payment-mode-${value}`}
                  className={`rounded-lg px-2 py-1.5 text-sm font-medium transition ${
                    mode === value
                      ? 'bg-brand-600 text-white'
                      : 'text-navy-600 hover:bg-navy-50'
                  }`}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'BANK' && (
            <div>
              <label className="label">Банк</label>
              <select
                className="input"
                data-testid="payment-bank"
                value={bankId}
                onChange={(e) => setBankId(e.target.value)}
              >
                <option value="">Выберите банк</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'MIXED' && (
            <div className="space-y-2">
              <div className="text-xs text-navy-600">
                Разбейте платёж по способам — сумма частей должна совпасть с
                суммой платежа
              </div>
              {rows.map((r, i) => (
                <div key={r.key} className="flex flex-wrap items-end gap-2">
                  <div className="w-24 shrink-0">
                    <label className="label">Сумма</label>
                    <input
                      type="number"
                      min={0}
                      className="input-sm w-full"
                      data-testid="payment-part-amount"
                      value={r.amount}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, amount: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="0"
                    />
                  </div>
                  <div className="w-28 shrink-0">
                    <label className="label">Чем</label>
                    <select
                      className="input-sm w-full"
                      data-testid="payment-part-method"
                      value={r.method}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  method: e.target.value as PaymentMethod,
                                  bankId:
                                    e.target.value === 'CASH' ? '' : x.bankId,
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="CASH">Наличные</option>
                      <option value="BANK">Банк</option>
                    </select>
                  </div>
                  {r.method === 'BANK' && (
                    <div className="min-w-[8rem] flex-1">
                      <label className="label">Банк</label>
                      <select
                        className="input-sm w-full"
                        data-testid="payment-part-bank"
                        value={r.bankId}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, bankId: e.target.value } : x,
                            ),
                          )
                        }
                      >
                        <option value="">Выберите</option>
                        {banks.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {rows.length > 1 && (
                    <button
                      type="button"
                      aria-label="Убрать часть"
                      className="mb-1 rounded-lg p-1 text-navy-400 hover:bg-white hover:text-red-600"
                      onClick={() =>
                        setRows((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-xs"
                  onClick={() => setRows((prev) => [...prev, newRow('CASH')])}
                >
                  <Plus size={14} /> Добавить часть
                </button>
                <span
                  className={`text-xs tabular-nums ${
                    mismatch ? 'font-medium text-red-600' : 'text-navy-600'
                  }`}
                >
                  Части: {formatPrice(partsSum)}
                  {mismatch ? ` ≠ ${formatPrice(declared)}` : ''}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="label">Комментарий (необязательно)</label>
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="Например: предоплата за материалы"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost flex-1 justify-center"
              onClick={reset}
            >
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary flex-1 justify-center"
              data-testid="payment-submit"
              disabled={saving || !!problem()}
              onClick={save}
            >
              {saving ? 'Вносим…' : 'Внести'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
