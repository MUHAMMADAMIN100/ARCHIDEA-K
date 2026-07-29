import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Spinner, PageHeader, ErrorState } from '../components/ui';
import { Period, PeriodFilter, StatCard } from '../components/common';
import { formatPrice } from '../lib/labels';
import { formatDateTz, monthRange } from '../lib/date';
import { userSeesAll } from '../types';
import type { AnalyticsFull } from '../types';

const COLORS = ['#0063a8', '#0078c9', '#2a93da', '#5fb1e8', '#95cdf0'];

export function Analytics() {
  const { user } = useAuth();
  const seesAll = userSeesAll(user);
  // По умолчанию — текущий месяц; переключатель периода ниже задаёт
  // ОДИН И ТОТ ЖЕ диапазон сразу для всех разрезов на странице (ТЗ 3.3).
  const [period, setPeriod] = useState<Period>(() => monthRange());

  const query = new URLSearchParams();
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);

  const { data, loading, error, reload } = useFetch<AnalyticsFull>(
    `/analytics/full?${query.toString()}`,
    { deps: [period.from, period.to] },
  );

  const rangeLabel =
    data?.from && data?.to
      ? `${formatDateTz(data.from)} — ${formatDateTz(data.to)}`
      : 'за всё время';

  // Показываем блок сверки, только если есть на что обратить внимание —
  // иначе он превращается в шум на каждой загрузке страницы.
  const reconciliation = data?.reconciliation;
  const hasDiscrepancy =
    !!reconciliation &&
    (reconciliation.ordersWithoutPrice > 0 || reconciliation.paidWithoutCloseDate > 0);

  return (
    <div>
      <PageHeader
        title="Аналитика и отчёты"
        subtitle={seesAll ? `Аналитика компании · ${rangeLabel}` : `Аналитика по вашим заказам · ${rangeLabel}`}
        action={<PeriodFilter value={period} onChange={setPeriod} />}
      />

      {error ? (
        <ErrorState onRetry={reload} />
      ) : loading && !data ? (
        <Spinner />
      ) : !data ? null : (
        <>
          <p className="mb-5 text-xs text-navy-400">
            Воронка, типы уборки, источники заявок и выручка ниже посчитаны за один и тот же
            период — цифры на странице сопоставимы между собой.
          </p>

          {hasDiscrepancy && reconciliation && (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <div className="font-semibold">Сверка за период</div>
              <div className="mt-1">
                Оплаченных заказов: <b>{reconciliation.paidOrdersInPeriod}</b>
                {reconciliation.ordersWithoutPrice > 0 && (
                  <>
                    {' '}
                    · без проставленной суммы: <b>{reconciliation.ordersWithoutPrice}</b>
                  </>
                )}
                {reconciliation.paidWithoutCloseDate > 0 && (
                  <>
                    {' '}
                    · оплачены без даты закрытия: <b>{reconciliation.paidWithoutCloseDate}</b>
                  </>
                )}
              </div>
              <p className="mt-1 text-xs text-amber-700">
                Такие заказы не попадают в выручку периода — проверьте и заполните недостающие
                поля в карточке заказа.
              </p>
            </div>
          )}

          {/* Доходы — приходят только руководителю (финансовые данные) */}
          {data.revenue && (
            <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="За выбранный период"
                value={formatPrice(data.revenue.period)}
                tone="positive"
                hint={rangeLabel}
              />
              <StatCard label="За день" value={formatPrice(data.revenue.day)} />
              <StatCard label="За неделю" value={formatPrice(data.revenue.week)} />
              <StatCard label="За месяц" value={formatPrice(data.revenue.month)} />
              <StatCard label="За квартал" value={formatPrice(data.revenue.quarter)} />
            </div>
          )}

          {/* Конверсия — за тот же период, что и выручка выше */}
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Конверсия в заказы"
              value={`${data.conversion.rate}%`}
              tone="positive"
              hint={`${data.conversion.paid} оплачено из ${data.conversion.total}`}
            />
            <StatCard label="Всего обращений" value={data.conversion.total} />
            <StatCard label="Отказы" value={data.conversion.rejected} tone="negative" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Доход по дням — финансы, только руководителю */}
            {data.revenueSeries && (
              <div className="card p-5 lg:col-span-2">
                <h3 className="mb-4 font-bold text-navy-900">Доход за 14 дней</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.revenueSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6f3fb" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#5fb1e8' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#5fb1e8' }} />
                    <Tooltip formatter={(v: number) => formatPrice(v)} />
                    <Bar dataKey="revenue" fill="#0078c9" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Заказы по типам уборки — за выбранный период */}
            <div className="card p-5">
              <h3 className="mb-4 font-bold text-navy-900">Заказы по типам уборки</h3>
              {data.byType.length === 0 ? (
                <p className="py-10 text-center text-sm text-navy-400">
                  За период заявок не было
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.byType}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6f3fb" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5fb1e8' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#5fb1e8' }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0063a8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Источники заявок — за выбранный период */}
            <div className="card p-5">
              <h3 className="mb-4 font-bold text-navy-900">Источники заявок</h3>
              {data.sources.length === 0 ? (
                <p className="py-10 text-center text-sm text-navy-400">
                  За период заявок не было
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={data.sources}
                      dataKey="count"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={(e: any) => e.label}
                    >
                      {data.sources.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Загруженность сотрудников — руководителю и ops-менеджеру, за всё время */}
            {data.managerWorkload && (
              <div className="card p-5 lg:col-span-2">
                <h3 className="mb-4 font-bold text-navy-900">Загруженность сотрудников</h3>
                <p className="mb-3 text-xs text-navy-400">
                  Текущая нагрузка (не зависит от периода выше): сколько заказов сейчас в работе
                  и сколько всего доведено до оплаты.
                </p>
                {data.managerWorkload.length === 0 ? (
                  <p className="py-10 text-center text-sm text-navy-400">
                    Пока ни один заказ не назначен ответственному
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.managerWorkload}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e6f3fb" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#5fb1e8' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#5fb1e8' }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="active" name="Активные заказы" fill="#0078c9" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="paid" name="Завершено" fill="#5fb1e8" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
