import { useState, type ReactNode } from 'react';
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
import { Skeleton, PageHeader, ErrorState } from '../components/ui';
import { ScrollArea } from '../components/ScrollArea';
import { Period, PeriodFilter, StatCard } from '../components/common';
import {
  DetailModal,
  DetailStats,
  DetailTable,
  DrillValue,
} from '../components/Drilldown';
import { OrdersDrilldownModal } from '../components/OrdersDrilldown';
import { formatPrice, SHIFT_GROUP_STATUS_LABEL } from '../lib/labels';
import { formatDateTz, monthRange } from '../lib/date';
import { userSeesAll } from '../types';
import type { AnalyticsFull, ShiftGroupStatus } from '../types';

const COLORS = ['#0063a8', '#0078c9', '#2a93da', '#5fb1e8', '#95cdf0'];

/** Подпись у каждой диаграммы: цифры кликабельны, это не очевидно само по себе */
const HINT = 'Нажмите на столбик или сектор — покажем заказы, из которых он сложился.';

/** Что именно расшифровываем: срез (metric+key) и как назвать модалку */
interface Drill {
  title: string;
  subtitle?: string;
  metric: string;
  key?: string;
  /** выезды бригады и смены клинера — не заказы, у них свой вид расшифровки */
  mode?: 'orders' | 'visits' | 'shifts';
}


/**
 * Таблица разреза: подпись, цифры и кликабельная строка.
 *
 * Своя, а не общая DataTable: здесь нет страниц и фильтров, зато нужна
 * компактность — таких блоков на экране несколько.
 */
function BreakdownCard<T>({
  title,
  hint,
  rows,
  columns,
  rowKey,
  emptyText,
}: {
  title: string;
  hint?: string;
  rows: T[];
  columns: {
    key: string;
    header: string;
    align?: 'left' | 'right';
    cell: (row: T) => ReactNode;
  }[];
  rowKey: (row: T) => string;
  emptyText: string;
}) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <h3 className="font-bold text-navy-900">{title}</h3>
      {hint && <p className="mt-0.5 mb-3 text-xs text-navy-600">{hint}</p>}
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-navy-600">{emptyText}</p>
      ) : (
        <ScrollArea axis="x" className="-mx-1" innerClassName="px-1" label={title}>
          {/*
            На телефоне таблица шире экрана. Минимальная ширина не даёт
            колонкам схлопнуться до нечитаемого, а прокрутка остаётся
            внутри блока — страница вбок не едет. Растворяющийся край
            ScrollArea показывает, что справа есть продолжение.
          */}
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-left text-[11px] uppercase tracking-wide text-navy-600">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`py-2 pr-3 font-semibold ${
                      c.align === 'right' ? 'text-right' : ''
                    }`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={rowKey(r)} className="border-b border-navy-50 last:border-0">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`py-2 pr-3 align-top ${
                        c.align === 'right' ? 'text-right tabular-nums' : ''
                      }`}
                    >
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </div>
  );
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
  /*
   * «Всё время» — это пустой диапазон, и без явного признака сервер понимал
   * его как «параметры не переданы» и молча подставлял текущий месяц. Человек
   * выбирал «Всё время», а видел цифры за месяц — и никак не мог этого понять.
   */
  if (!period.from && !period.to) query.set('period', 'all');

  const { data, loading, error, reload } = useFetch<AnalyticsFull>(
    `/analytics/full?${query.toString()}`,
    { deps: [period.from, period.to] },
  );

  const bd = data?.breakdowns;

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
    <div className="animate-page-in">
      <PageHeader
        title="Аналитика и отчёты"
        subtitle={seesAll ? `Аналитика компании · ${rangeLabel}` : `Аналитика по вашим заказам · ${rangeLabel}`}
        action={<PeriodFilter value={period} onChange={setPeriod} />}
      />

      {error ? (
        <ErrorState text={error ?? undefined} onRetry={reload} />
      ) : loading && !data ? (
        /*
         * Заглушка повторяет раскладку страницы: ряд плиток с цифрами и
         * блоки диаграмм под ними. Место занято заранее, поэтому цифры
         * приходят на готовые позиции и экран не прыгает.
         */
        <div role="status" aria-label="Загрузка">
          <Skeleton className="mb-5 h-4 w-full max-w-2xl rounded-md" />
          {isDirector && (
            <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-md" />
              ))}
            </div>
          )}
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-md" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-md lg:col-span-2" />
            <Skeleton className="h-80 rounded-md" />
            <Skeleton className="h-80 rounded-md" />
          </div>
        </div>
      ) : !data ? null : (
        <>
          <p className="mb-5 text-xs text-navy-600">
            Воронка, типы уборки, источники заявок и выручка ниже посчитаны за один и тот же
            период — цифры на странице сопоставимы между собой.
          </p>

          {hasDiscrepancy && reconciliation && (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-card">
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
              {/*
                Раньше здесь стояли четыре окна «за день / неделю / месяц /
                квартал», которые считались НЕЗАВИСИМО от фильтра сверху:
                выбираешь «Прошлый месяц», а они показывают текущие цифры —
                на экране оказывались четыре одинаковых числа. Теперь всё за
                один и тот же период, но разные показатели.
              */}
              <StatCard
                label="Оплаченных заказов"
                value={bd?.totals.paidOrders ?? 0}
                hint={rangeLabel}
                title="Заказы, оплаченные за выбранный период"
                onClick={() =>
                  setDrill({
                    title: 'Оплаченные заказы',
                    subtitle: rangeLabel,
                    metric: 'revenuePeriod',
                  })
                }
              />
              <StatCard
                label="Средний чек"
                value={formatPrice(bd?.totals.average ?? 0)}
                hint="выручка ÷ оплаченные заказы"
                title="Из каких заказов сложился средний чек"
                onClick={() =>
                  setDrill({
                    title: 'Средний чек — из чего сложился',
                    subtitle: rangeLabel,
                    metric: 'revenuePeriod',
                  })
                }
              />
              <StatCard
                label="Скидки"
                value={formatPrice(bd?.totals.discountTotal ?? 0)}
                tone={bd && bd.totals.discountTotal > 0 ? 'negative' : 'default'}
                hint="сколько отдали клиентам"
                title="Заказы, по которым дали скидку"
                onClick={() =>
                  setDrill({
                    title: 'Скидки за период',
                    subtitle: rangeLabel,
                    metric: 'revenuePeriod',
                  })
                }
              />
              <StatCard
                label="Доп. услуги"
                value={formatPrice(bd?.totals.extrasRevenue ?? 0)}
                hint="сверх основной уборки"
                title="Какие доп. услуги брали за период"
                onClick={() =>
                  setDrill({
                    title: 'Доп. услуги за период',
                    subtitle: rangeLabel,
                    // только заказы, где доп. услуги есть, — а не вся выручка
                    metric: 'extrasAllOrders',
                  })
                }
              />
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

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {/* Доход по дням — финансы, только руководителю */}
            {data.revenueSeries && (
              <div className="card min-w-0 overflow-hidden p-5 lg:col-span-2">
                <h3 className="mb-1 font-bold text-navy-900">Доход за 14 дней</h3>
                <p className="mb-3 text-xs text-navy-600">{HINT}</p>
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
            <div className="card min-w-0 overflow-hidden p-5">
              <h3 className="mb-1 font-bold text-navy-900">Заказы по типам уборки</h3>
              <p className="mb-3 text-xs text-navy-600">{HINT}</p>
              {data.byType.length === 0 ? (
                <p className="py-10 text-center text-sm text-navy-600">
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
            <div className="card min-w-0 overflow-hidden p-5">
              <h3 className="mb-1 font-bold text-navy-900">Источники заявок</h3>
              <p className="mb-3 text-xs text-navy-600">{HINT}</p>
              {data.sources.length === 0 ? (
                <p className="py-10 text-center text-sm text-navy-600">
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
            {/*
              Разрезы за выбранный период. Каждая строка кликабельна: цифра
              в аналитике не должна быть тупиком — по клику видно, из каких
              заказов она сложилась.
            */}
            {bd && (
              <div className="min-w-0 space-y-4 lg:col-span-2">
                <BreakdownCard
                  title="Менеджеры за период"
                  hint={`Сколько обращений принял каждый и сколько довёл до оплаты · ${rangeLabel}`}
                  rows={bd.managers}
                  rowKey={(r) => r.id ?? 'none'}
                  emptyText="За период обращений не было"
                  columns={[
                    {
                      key: 'name',
                      header: 'Менеджер',
                      cell: (r) => (
                        <DrillValue
                          title="Заказы этого менеджера за период"
                          onClick={() =>
                            setDrill({
                              title: `Заказы — ${r.name}`,
                              subtitle: rangeLabel,
                              metric: 'managerOrders',
                              key: r.id ?? 'none',
                            })
                          }
                        >
                          {r.name}
                        </DrillValue>
                      ),
                    },
                    { key: 'total', header: 'Обращений', align: 'right', cell: (r) => r.total },
                    {
                      key: 'paid',
                      header: 'Оплачено',
                      align: 'right',
                      cell: (r) => (
                        <DrillValue
                          align="right"
                          tone="success"
                          disabled={r.paid === 0}
                          title="Оплаченные заказы этого менеджера"
                          onClick={() =>
                            setDrill({
                              title: `Оплачено — ${r.name}`,
                              subtitle: rangeLabel,
                              metric: 'managerPaidOrders',
                              key: r.id ?? 'none',
                            })
                          }
                        >
                          {r.paid}
                        </DrillValue>
                      ),
                    },
                    ...(isDirector
                      ? [
                          {
                            key: 'amount',
                            header: 'Сумма',
                            align: 'right' as const,
                            cell: (r: typeof bd.managers[number]) => formatPrice(r.amount),
                          },
                          {
                            key: 'average',
                            header: 'Сред. чек',
                            align: 'right' as const,
                            cell: (r: typeof bd.managers[number]) => formatPrice(r.average),
                          },
                        ]
                      : []),
                  ]}
                />

                <div className="grid min-w-0 gap-4">
                  <BreakdownCard
                    title="Услуги за период"
                    hint="По оплаченным заказам"
                    rows={bd.services}
                    rowKey={(r) => r.key}
                    emptyText="Оплаченных заказов за период нет"
                    columns={[
                      { key: 'label', header: 'Услуга', cell: (r) => r.label },
                      {
                        key: 'count',
                        header: 'Заказов',
                        align: 'right',
                        cell: (r) => (
                          <DrillValue
                            align="right"
                            title="Заказы этой услуги за период"
                            onClick={() =>
                              setDrill({
                                title: `Услуга — ${r.label}`,
                                subtitle: rangeLabel,
                                metric: 'serviceOrders',
                                key: r.key,
                              })
                            }
                          >
                            {r.count}
                          </DrillValue>
                        ),
                      },
                      ...(isDirector
                        ? [
                            {
                              key: 'amount',
                              header: 'Сумма',
                              align: 'right' as const,
                              cell: (r: typeof bd.services[number]) => formatPrice(r.amount),
                            },
                          ]
                        : []),
                    ]}
                  />

                  <BreakdownCard
                    title="Доп. услуги за период"
                    hint="Что берут сверх основной уборки"
                    rows={bd.extras}
                    rowKey={(r) => r.key}
                    emptyText="Доп. услуги за период не брали"
                    columns={[
                      { key: 'label', header: 'Услуга', cell: (r) => r.label },
                      {
                        key: 'count',
                        header: 'Раз взяли',
                        align: 'right',
                        cell: (r) => (
                          <DrillValue
                            align="right"
                            title="Заказы, где брали эту доп. услугу"
                            onClick={() =>
                              setDrill({
                                title: `Доп. услуга — ${r.label}`,
                                subtitle: rangeLabel,
                                metric: 'extraOrders',
                                key: r.key,
                              })
                            }
                          >
                            {r.count}
                          </DrillValue>
                        ),
                      },
                      ...(isDirector
                        ? [
                            {
                              key: 'amount',
                              header: 'Сумма',
                              align: 'right' as const,
                              cell: (r: typeof bd.extras[number]) => formatPrice(r.amount),
                            },
                          ]
                        : []),
                    ]}
                  />

                  <BreakdownCard
                    title="Бригады за период"
                    hint="Выезды и смены по дате выезда"
                    rows={bd.brigades}
                    rowKey={(r) => r.id ?? 'none'}
                    emptyText="Выездов за период не было"
                    columns={[
                      {
                        key: 'name',
                        header: 'Бригада',
                        cell: (r) => (
                          <span>
                            {r.name}
                            {r.leader && (
                              <span className="block text-xs text-navy-600">
                                бригадир: {r.leader}
                              </span>
                            )}
                          </span>
                        ),
                      },
                      {
                        key: 'visits',
                        header: 'Выездов',
                        align: 'right',
                        cell: (r) => (
                          <DrillValue
                            align="right"
                            title="Все выезды бригады: дата, адрес, состав"
                            onClick={() =>
                              setDrill({
                                title: `Выезды — ${r.name}`,
                                subtitle: rangeLabel,
                                metric: 'brigadeVisits',
                                key: r.id ?? 'none',
                                mode: 'visits',
                              })
                            }
                          >
                            {r.visits}
                          </DrillValue>
                        ),
                      },
                      {
                        key: 'shifts',
                        header: 'Смен',
                        align: 'right',
                        cell: (r) => (
                          <DrillValue
                            align="right"
                            title="Из каких выездов сложились смены"
                            onClick={() =>
                              setDrill({
                                title: `Смены — ${r.name}`,
                                subtitle: rangeLabel,
                                metric: 'brigadeVisits',
                                key: r.id ?? 'none',
                                mode: 'visits',
                              })
                            }
                          >
                            {r.shifts}
                          </DrillValue>
                        ),
                      },
                      ...(isDirector
                        ? [
                            {
                              key: 'accrued',
                              header: 'Начислено',
                              align: 'right' as const,
                              cell: (r: typeof bd.brigades[number]) => formatPrice(r.accrued),
                            },
                          ]
                        : []),
                    ]}
                  />

                  <BreakdownCard
                    title="Клинеры за период"
                    hint="Кто сколько отработал смен"
                    rows={bd.cleaners}
                    rowKey={(r) => r.id}
                    emptyText="Смен за период не было"
                    columns={[
                      { key: 'name', header: 'Клинер', cell: (r) => r.name },
                      {
                        key: 'shifts',
                        header: 'Смен',
                        align: 'right',
                        cell: (r) => (
                          <DrillValue
                            align="right"
                            title="Каждая смена: день, адрес, ставка"
                            onClick={() =>
                              setDrill({
                                title: `Смены — ${r.name}`,
                                subtitle: rangeLabel,
                                metric: 'cleanerShifts',
                                key: r.id,
                                mode: 'shifts',
                              })
                            }
                          >
                            {r.shifts}
                          </DrillValue>
                        ),
                      },
                      ...(isDirector
                        ? [
                            {
                              key: 'accrued',
                              header: 'Начислено',
                              align: 'right' as const,
                              cell: (r: typeof bd.cleaners[number]) => formatPrice(r.accrued),
                            },
                          ]
                        : []),
                    ]}
                  />

                  <BreakdownCard
                    title="Клиенты за период"
                    hint="Топ по оплаченным заказам"
                    rows={bd.clients}
                    rowKey={(r) => r.id}
                    emptyText="Оплаченных заказов за период нет"
                    columns={[
                      { key: 'name', header: 'Клиент', cell: (r) => r.name },
                      {
                        key: 'count',
                        header: 'Заказов',
                        align: 'right',
                        cell: (r) => (
                          <DrillValue
                            align="right"
                            title="Оплаченные заказы клиента за период"
                            onClick={() =>
                              setDrill({
                                title: `Клиент — ${r.name}`,
                                subtitle: rangeLabel,
                                metric: 'clientOrders',
                                key: r.id,
                              })
                            }
                          >
                            {r.count}
                          </DrillValue>
                        ),
                      },
                      ...(isDirector
                        ? [
                            {
                              key: 'amount',
                              header: 'Сумма',
                              align: 'right' as const,
                              cell: (r: typeof bd.clients[number]) => formatPrice(r.amount),
                            },
                          ]
                        : []),
                    ]}
                  />

                  <BreakdownCard
                    title="Источники за период"
                    hint="Не только обращения, но и деньги"
                    rows={bd.sourceRows}
                    rowKey={(r) => r.source}
                    emptyText="Обращений за период нет"
                    columns={[
                      {
                        key: 'label',
                        header: 'Источник',
                        cell: (r) => (
                          <DrillValue
                            title="Обращения из этого источника"
                            onClick={() =>
                              setDrill({
                                title: `Источник — ${r.label}`,
                                subtitle: rangeLabel,
                                metric: 'source',
                                key: r.source,
                              })
                            }
                          >
                            {r.label}
                          </DrillValue>
                        ),
                      },
                      { key: 'total', header: 'Обращений', align: 'right', cell: (r) => r.total },
                      { key: 'paid', header: 'Оплачено', align: 'right', cell: (r) => r.paid },
                      ...(isDirector
                        ? [
                            {
                              key: 'amount',
                              header: 'Сумма',
                              align: 'right' as const,
                              cell: (r: typeof bd.sourceRows[number]) => formatPrice(r.amount),
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
              </div>
            )}

            {/*
              KPI менеджеров за период.
              Загруженность ниже показывает «сейчас», а это — работу за
              выбранный промежуток: сколько звонил, сколько принял, сколько
              довёл до оплаты. На телефоне таблица не влезает, поэтому там
              каждая строка становится карточкой.
            */}
            {data.managerKpi && (
              <div className="card min-w-0 p-5 lg:col-span-2">
                <h3 className="mb-1 font-bold text-navy-900">KPI менеджеров</h3>
                <p className="mb-3 text-xs text-navy-600">
                  За выбранный период. Заявки, оплаты и конверсия считаются по
                  обращениям, созданным в этом периоде, — иначе конверсия
                  сравнивала бы заявки одного месяца с оплатами другого.
                </p>
                {data.managerKpi.length === 0 ? (
                  <p className="py-8 text-center text-sm text-navy-600">
                    За этот период у сотрудников нет ни заявок, ни звонков
                  </p>
                ) : (
                  <>
                    {/* Телефон: карточка на сотрудника */}
                    <div className="space-y-2 sm:hidden">
                      {data.managerKpi.map((m) => (
                        <div
                          key={m.id ?? 'none'}
                          className="rounded-xl border border-navy-100 p-3"
                        >
                          <div className="mb-2 flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate font-semibold text-navy-900">
                              {m.name}
                            </span>
                            <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-brand-600">
                              {m.conversion}%
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            <KpiCell label="Звонки" value={m.calls} />
                            <KpiCell
                              label="Хол · Нейтр · Гор"
                              value={`${m.cold} · ${m.neutral} · ${m.hot}`}
                            />
                            <KpiCell label="Новых клиентов" value={m.newClients} />
                            <KpiCell label="Заявок" value={m.orders} />
                            <KpiCell label="Оплачено" value={m.paid} />
                            <KpiCell label="Отказов" value={m.rejected} />
                            {seesAll && (
                              <KpiCell
                                label="Продано"
                                value={formatPrice(m.amount)}
                              />
                            )}
                          </dl>
                        </div>
                      ))}
                    </div>

                    {/* Компьютер: обычная таблица */}
                    <ScrollArea
                      axis="x"
                      className="hidden sm:block"
                      label="KPI менеджеров"
                    >
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-600">
                            <th className="py-2 pr-3 font-semibold">Сотрудник</th>
                            <th className="py-2 pr-3 text-right font-semibold">Звонки</th>
                            <th className="py-2 pr-3 text-right font-semibold">Хол</th>
                            <th className="py-2 pr-3 text-right font-semibold">Нейтр</th>
                            <th className="py-2 pr-3 text-right font-semibold">Гор</th>
                            <th className="py-2 pr-3 text-right font-semibold">Клиентов</th>
                            <th className="py-2 pr-3 text-right font-semibold">Заявок</th>
                            <th className="py-2 pr-3 text-right font-semibold">Оплачено</th>
                            <th className="py-2 pr-3 text-right font-semibold">Отказов</th>
                            <th className="py-2 pr-3 text-right font-semibold">Конверсия</th>
                            {seesAll && (
                              <th className="py-2 text-right font-semibold">Продано</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {data.managerKpi.map((m) => (
                            <tr
                              key={m.id ?? 'none'}
                              className="border-b border-navy-50 last:border-0"
                            >
                              <td className="py-2 pr-3 font-medium text-navy-900">
                                {m.name}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">{m.calls}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-sky-700">{m.cold}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-amber-700">{m.neutral}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-red-700">{m.hot}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{m.newClients}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{m.orders}</td>
                              <td className="py-2 pr-3 text-right tabular-nums font-semibold">{m.paid}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{m.rejected}</td>
                              <td className="py-2 pr-3 text-right font-bold tabular-nums text-brand-600">
                                {m.conversion}%
                              </td>
                              {seesAll && (
                                <td className="py-2 text-right font-semibold tabular-nums">
                                  {formatPrice(m.amount)}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollArea>
                  </>
                )}
              </div>
            )}

            {data.managerWorkload && (
              <div className="card min-w-0 overflow-hidden p-5 lg:col-span-2">
                <h3 className="mb-1 font-bold text-navy-900">Загруженность сотрудников</h3>
                <p className="mb-3 text-xs text-navy-600">
                  Текущая нагрузка (не зависит от периода выше): сколько заказов сейчас в работе
                  и сколько всего доведено до оплаты. {HINT}
                </p>
                {data.managerWorkload.length === 0 ? (
                  <p className="py-10 text-center text-sm text-navy-600">
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

      {drill &&
        (drill.mode === 'visits' || drill.mode === 'shifts' ? (
          <WorkDrillModal
            drill={drill}
            from={period.from}
            to={period.to}
            showMoney={isDirector}
            onClose={() => setDrill(null)}
          />
        ) : (
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
        ))}
    </div>
  );
}


/** Показатель в карточке KPI на телефоне: подпись слева, число справа */
function KpiCell({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <dt className="truncate text-navy-600">{label}</dt>
      <dd className="text-right font-semibold tabular-nums text-navy-900">
        {value}
      </dd>
    </>
  );
}

/** Строка расшифровки выезда или смены (metric brigadeVisits / cleanerShifts) */
interface WorkDrillRow {
  id: string;
  date: string;
  address: string;
  startTime?: string | null;
  status: ShiftGroupStatus;
  managerName?: string | null;
  brigadeName?: string | null;
  members?: string[];
  shifts?: number;
  role?: string | null;
  rate?: number | null;
  accrued?: number | null;
}

/**
 * Расшифровка «26 смен — какие именно»: каждый выезд бригады или смена
 * клинера с датой, адресом и составом. Заказами это не является, поэтому
 * у неё свой вид, а не таблица заказов.
 */
function WorkDrillModal({
  drill,
  from,
  to,
  showMoney,
  onClose,
}: {
  drill: Drill;
  from?: string;
  to?: string;
  showMoney: boolean;
  onClose: () => void;
}) {
  const query = new URLSearchParams({ metric: drill.metric });
  if (drill.key) query.set('key', drill.key);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  // пустой диапазон = «всё время»; без признака сервер взял бы текущий месяц
  if (!from && !to) query.set('period', 'all');

  const { data, loading, error, reload } = useFetch<{
    kind: 'visits' | 'shifts';
    rows: WorkDrillRow[];
  }>(`/analytics/drilldown?${query.toString()}`, {
    deps: [drill.metric, drill.key, from, to],
  });

  const rows = data?.rows ?? [];
  const isVisits = drill.mode === 'visits';
  const accruedTotal = rows.reduce(
    (sum, r) => sum + (isVisits ? (r.accrued ?? 0) : (r.rate ?? 0)),
    0,
  );

  return (
    <DetailModal title={drill.title} subtitle={drill.subtitle} onClose={onClose}>
      {error ? (
        <ErrorState text={error ?? undefined} onRetry={reload} />
      ) : (
        <>
          <DetailStats
            items={[
              { label: isVisits ? 'Выездов' : 'Смен', value: rows.length },
              ...(isVisits
                ? [
                    {
                      label: 'Смен',
                      value: rows.reduce((sum, r) => sum + (r.shifts ?? 0), 0),
                    },
                  ]
                : []),
              ...(showMoney
                ? [
                    {
                      label: 'Начислено',
                      value: formatPrice(accruedTotal),
                      tone: 'success' as const,
                    },
                  ]
                : []),
            ]}
          />

          <DetailTable
            rows={rows}
            loading={loading}
            rowKey={(r: WorkDrillRow) => r.id}
            emptyText={isVisits ? 'Выездов за период нет' : 'Смен за период нет'}
            columns={[
              {
                key: 'date',
                header: 'Дата',
                cell: (r: WorkDrillRow) => (
                  <div>
                    <div className="font-medium text-navy-900">
                      {formatDateTz(r.date)}
                    </div>
                    {r.startTime && (
                      <div className="text-xs text-navy-600">{r.startTime}</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'address',
                header: 'Адрес',
                cell: (r: WorkDrillRow) => (
                  <div>
                    <div className="text-navy-800">{r.address}</div>
                    <div className="text-xs text-navy-600">
                      {SHIFT_GROUP_STATUS_LABEL[r.status] ?? r.status}
                      {isVisits && r.managerName ? ` · ${r.managerName}` : ''}
                      {!isVisits && r.brigadeName ? ` · ${r.brigadeName}` : ''}
                    </div>
                  </div>
                ),
              },
              isVisits
                ? {
                    key: 'members',
                    header: 'Состав',
                    cell: (r: WorkDrillRow) => (
                      <span className="text-sm text-navy-600">
                        {(r.members ?? []).join(', ') || '—'}
                      </span>
                    ),
                  }
                : {
                    key: 'role',
                    header: 'Роль',
                    cell: (r: WorkDrillRow) => (
                      <span className="text-navy-600">{r.role ?? '—'}</span>
                    ),
                  },
              ...(showMoney
                ? [
                    {
                      key: 'money',
                      header: isVisits ? 'Начислено' : 'Ставка',
                      align: 'right' as const,
                      cell: (r: WorkDrillRow) =>
                        formatPrice(isVisits ? (r.accrued ?? 0) : (r.rate ?? 0)),
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}
    </DetailModal>
  );
}
