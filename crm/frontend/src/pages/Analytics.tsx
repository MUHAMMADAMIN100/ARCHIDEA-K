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
import { DrillValue } from '../components/Drilldown';
import { OrdersDrilldownModal } from '../components/OrdersDrilldown';
import { formatPrice } from '../lib/labels';
import { formatDateTz, monthRange } from '../lib/date';
import { userSeesAll } from '../types';
import type { AnalyticsFull } from '../types';

const COLORS = ['#0063a8', '#0078c9', '#2a93da', '#5fb1e8', '#95cdf0'];

/** Подпись у каждой диаграммы: цифры кликабельны, это не очевидно само по себе */
const HINT = 'Нажмите на столбик или сектор — покажем заказы, из которых он сложился.';

/** Что именно расшифровываем: срез (metric+key) и как назвать модалку */
interface Drill {
  title: string;
  subtitle?: string;
  metric: string;
  key?: string;
}

export function Analytics() {
  const { user } = useAuth();
  const seesAll = userSeesAll(user);
  const isDirector = user?.role === 'DIRECTOR';
  // ни одна цифра на этом экране не должна быть тупиком: клик по карточке,
  // столбику или сектору открывает список заказов, из которых она сложилась
  const [drill, setDrill] = useState<Drill | null>(null);
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
                Оплаченных заказов:{' '}
                <DrillValue
                  tone="strong"
                  title="Какие именно заказы оплачены"
                  onClick={() =>
                    setDrill({
                      title: 'Оплаченные заказы за период',
                      subtitle: rangeLabel,
                      metric: 'revenuePeriod',
                    })
                  }
                >
                  {reconciliation.paidOrdersInPeriod}
                </DrillValue>
                {reconciliation.ordersWithoutPrice > 0 && (
                  <>
                    {' '}
                    · без проставленной суммы:{' '}
                    <DrillValue
                      tone="danger"
                      title="Заказы, которые не попали в выручку"
                      onClick={() =>
                        setDrill({
                          title: 'Оплачены, но сумма не проставлена',
                          subtitle: `${rangeLabel} · эти заказы не попадают в выручку`,
                          metric: 'unpriced',
                        })
                      }
                    >
                      {reconciliation.ordersWithoutPrice}
                    </DrillValue>
                  </>
                )}
                {reconciliation.paidWithoutCloseDate > 0 && (
                  <>
                    {' '}
                    · оплачены без даты закрытия:{' '}
                    <DrillValue
                      tone="danger"
                      title="Заказы без даты закрытия"
                      onClick={() =>
                        setDrill({
                          title: 'Оплачены без даты закрытия',
                          subtitle: 'Такой заказ не попадёт ни в один период',
                          metric: 'noCloseDate',
                        })
                      }
                    >
                      {reconciliation.paidWithoutCloseDate}
                    </DrillValue>
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
                title="Из каких заказов сложилась выручка периода"
                onClick={() =>
                  setDrill({
                    title: 'Выручка за период',
                    subtitle: rangeLabel,
                    metric: 'revenuePeriod',
                  })
                }
              />
              {(
                [
                  ['day', 'За день'],
                  ['week', 'За неделю'],
                  ['month', 'За месяц'],
                  ['quarter', 'За квартал'],
                ] as const
              ).map(([key, label]) => (
                <StatCard
                  key={key}
                  label={label}
                  value={formatPrice(data.revenue![key])}
                  title={`Заказы, оплаченные ${label.toLowerCase()}`}
                  onClick={() =>
                    setDrill({
                      title: `Выручка ${label.toLowerCase()}`,
                      subtitle: 'Оплаченные заказы своего окна — независимо от периода сверху',
                      metric: 'revenueMoment',
                      key,
                    })
                  }
                />
              ))}
            </div>
          )}

          {/* Конверсия — за тот же период, что и выручка выше */}
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Конверсия в заказы"
              value={`${data.conversion.rate}%`}
              tone="positive"
              hint={`${data.conversion.paid} оплачено из ${data.conversion.total}`}
              title="Какие обращения дошли до оплаты"
              onClick={() =>
                setDrill({
                  title: 'Дошли до оплаты',
                  subtitle: `${data.conversion.paid} из ${data.conversion.total} · ${rangeLabel}`,
                  metric: 'conversionPaid',
                })
              }
            />
            <StatCard
              label="Всего обращений"
              value={data.conversion.total}
              title="Все обращения за период"
              onClick={() =>
                setDrill({
                  title: 'Все обращения за период',
                  subtitle: rangeLabel,
                  metric: 'conversionTotal',
                })
              }
            />
            <StatCard
              label="Отказы"
              value={data.conversion.rejected}
              tone="negative"
              title="Кто отказался и почему"
              onClick={() =>
                setDrill({
                  title: 'Отказы за период',
                  subtitle: rangeLabel,
                  metric: 'conversionRejected',
                })
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Доход по дням — финансы, только руководителю */}
            {data.revenueSeries && (
              <div className="card p-5 lg:col-span-2">
                <h3 className="mb-1 font-bold text-navy-900">Доход за 14 дней</h3>
                <p className="mb-3 text-xs text-navy-400">{HINT}</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.revenueSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6f3fb" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#5fb1e8' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#5fb1e8' }} />
                    <Tooltip formatter={(v: number) => formatPrice(v)} />
                    <Bar
                      dataKey="revenue"
                      fill="#0078c9"
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      onClick={(bar: any) =>
                        bar?.payload?.day &&
                        setDrill({
                          title: `Оплачено ${formatDateTz(bar.payload.day)}`,
                          subtitle: 'Заказы, закрытые в этот день',
                          metric: 'revenueDay',
                          key: bar.payload.day,
                        })
                      }
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Заказы по типам уборки — за выбранный период */}
            <div className="card p-5">
              <h3 className="mb-1 font-bold text-navy-900">Заказы по типам уборки</h3>
              <p className="mb-3 text-xs text-navy-400">{HINT}</p>
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
                    <Bar
                      dataKey="count"
                      fill="#0063a8"
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      onClick={(bar: any) =>
                        bar?.payload?.type &&
                        setDrill({
                          title: bar.payload.label,
                          subtitle: `Заказы этого типа · ${rangeLabel}`,
                          metric: 'type',
                          key: bar.payload.type,
                        })
                      }
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Источники заявок — за выбранный период */}
            <div className="card p-5">
              <h3 className="mb-1 font-bold text-navy-900">Источники заявок</h3>
              <p className="mb-3 text-xs text-navy-400">{HINT}</p>
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
                      cursor="pointer"
                      onClick={(slice: any) =>
                        slice?.payload?.source &&
                        setDrill({
                          title: `Источник: ${slice.payload.label}`,
                          subtitle: `Заявки с этого источника · ${rangeLabel}`,
                          metric: 'source',
                          key: slice.payload.source,
                        })
                      }
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
                <h3 className="mb-1 font-bold text-navy-900">Загруженность сотрудников</h3>
                <p className="mb-3 text-xs text-navy-400">
                  Текущая нагрузка (не зависит от периода выше): сколько заказов сейчас в работе
                  и сколько всего доведено до оплаты. {HINT}
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
                      <Bar
                        dataKey="active"
                        name="Активные заказы"
                        fill="#0078c9"
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        onClick={(bar: any) =>
                          bar?.payload &&
                          setDrill({
                            title: `${bar.payload.name} — в работе`,
                            subtitle: 'Заказы, которые сейчас на этом сотруднике',
                            metric: 'managerActive',
                            key: bar.payload.id || 'none',
                          })
                        }
                      />
                      <Bar
                        dataKey="paid"
                        name="Завершено"
                        fill="#5fb1e8"
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        onClick={(bar: any) =>
                          bar?.payload &&
                          setDrill({
                            title: `${bar.payload.name} — доведено до оплаты`,
                            subtitle: 'Все оплаченные заказы этого сотрудника',
                            metric: 'managerPaid',
                            key: bar.payload.id || 'none',
                          })
                        }
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {drill && (
        <OrdersDrilldownModal
          title={drill.title}
          subtitle={drill.subtitle}
          metric={drill.metric}
          drillKey={drill.key}
          from={period.from}
          to={period.to}
          showMoney={isDirector}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}
