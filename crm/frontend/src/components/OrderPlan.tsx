import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal } from './ui';
import { printDocument } from '../lib/print';
import { formatDateTz } from '../lib/date';

/**
 * План производства работ по заказу (ТЗ: планирование).
 *
 * Отвечает на два вопроса, которые до этого считали в уме: сколько дней
 * займут работы при этой бригаде и что делать в каждый из дней.
 *
 * План не хранится, а считается сервером из объёма, выработки услуги и числа
 * людей: поменяли состав бригады — срок пересчитался сам. Сохранённый план
 * начал бы врать в тот же день.
 */

interface PlanDay {
  day: number;
  date: string | null;
  area: number;
  pieces: { title: string; area: number }[];
}

interface PlanResponse {
  canPlan: boolean;
  reason: string | null;
  serviceTitle?: string | null;
  unit: string;
  perPersonPerDay: number;
  people: number;
  volume: number;
  perDay?: number;
  totalDays: number;
  days: PlanDay[];
}

export function OrderPlan({
  orderId,
  clientName,
  address,
  onClose,
}: {
  orderId: string;
  clientName?: string;
  address?: string | null;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<PlanResponse>(`/orders/${orderId}/plan`)
      .then((r) => setPlan(r.data))
      .catch(() => setFailed(true));
  }, [orderId]);

  return (
    <Modal open onClose={onClose} title="План производства работ" wide>
      <div className="space-y-4">
        {failed && (
          <p className="text-sm text-red-600">Не удалось рассчитать план</p>
        )}
        {!plan && !failed && <p className="text-sm text-navy-500">Считаем…</p>}

        {plan && !plan.canPlan && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {plan.reason}
          </p>
        )}

        {plan?.canPlan && (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ['Объём', `${plan.volume} ${plan.unit}`],
                ['Людей в бригаде', String(plan.people)],
                [
                  'Выработка',
                  `${plan.perPersonPerDay} ${plan.unit}/чел. в смену`,
                ],
                ['Срок', `${plan.totalDays} дн.`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-navy-50 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-navy-600">
                    {label}
                  </div>
                  <div className="text-sm font-bold text-navy-900">{value}</div>
                </div>
              ))}
            </div>

            {/* Печатная форма графика — её отдают бригадиру и клиенту */}
            <div className="rounded-xl border border-navy-200">
              <div className="border-b border-navy-100 bg-navy-50 px-3 py-2 text-sm font-semibold text-navy-900">
                График работ{clientName ? ` — ${clientName}` : ''}
                {address ? ` · ${address}` : ''}
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-navy-600">
                    <th className="border-b border-navy-100 px-3 py-1.5">День</th>
                    <th className="border-b border-navy-100 px-3 py-1.5">Дата</th>
                    <th className="border-b border-navy-100 px-3 py-1.5">
                      Что делаем
                    </th>
                    <th className="border-b border-navy-100 px-3 py-1.5 text-right">
                      Объём
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plan.days.map((d) => (
                    <tr key={d.day}>
                      <td className="border-b border-navy-50 px-3 py-1.5 font-medium text-navy-900">
                        {d.day}
                      </td>
                      <td className="border-b border-navy-50 px-3 py-1.5 whitespace-nowrap text-navy-700">
                        {d.date ? formatDateTz(d.date) : '—'}
                      </td>
                      <td className="border-b border-navy-50 px-3 py-1.5 text-navy-700">
                        {d.pieces.length
                          ? d.pieces.map((p) => p.title).join(', ')
                          : `${plan.serviceTitle ?? 'Работы'} — ${d.area} ${plan.unit}`}
                      </td>
                      <td className="border-b border-navy-50 px-3 py-1.5 text-right tabular-nums text-navy-900">
                        {d.area} {plan.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-navy-500">
              Неполный день считается днём: бригада не выезжает на полсмены.
              Даты проставлены от даты уборки в заказе.
            </p>
          </>
        )}

        <div className="flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onClose}>
            Закрыть
          </button>
          {plan?.canPlan && (
            <button
              className="btn-primary flex-1 justify-center"
              onClick={() => printDocument(`План работ — ${clientName ?? ''}`)}
            >
              Скачать PDF
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
