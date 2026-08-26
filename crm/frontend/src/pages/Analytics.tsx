import { useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AXIS_TICK,
  BAR_ANIMATION,
  barGap,
  CHART,
  chartGradients,
  ChartTooltip,
  CURSOR_FILL,
  Donut,
  GRID_STROKE,
  gradient,
  useWideScreen,
  valueLabel,
} from '../components/charts';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { userSeesFinance } from '../types';
import { Skeleton, PageHeader, ErrorState } from '../components/ui';
import { StatTile } from '../components/live';
import {
  EmptyRows,
  EntriesDrillModal,
  LevelBadge,
  NameCell,
  ShareCell,
  leaderOf,
} from '../components/breakdown';
import {
  ArrowDownRight,
  Brush,
  CheckCircle2,
  HardHat,
  Inbox,
  Percent,
  Receipt,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { ScrollArea } from '../components/ScrollArea';
import { Period, PeriodFilter } from '../components/common';
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


/** Подпись у каждой диаграммы: цифры кликабельны, это не очевидно само по себе */
const HINT = 'Нажмите на столбик или сектор — покажем заказы, из которых он сложился.';

/** Что именно расшифровываем: срез (metric+key) и как назвать модалку */
interface Drill {
  title: string;
  subtitle?: string;
  metric: string;
  key?: string;
  /**
   * выезды бригады и смены клинера — не заказы, у них свой вид расшифровки;
   * entries — операции книги (расходы, зарплаты) за плиткой с деньгами
   */
  mode?: 'orders' | 'visits' | 'shifts' | 'entries';
  /** только эти статьи книги (например, Зарплата и Премии) */
  categories?: string[];
  /** показать сверху арифметику чистого дохода */
  net?: boolean;
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
  footer,
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
  /**
   * Строка «Итого» внизу таблицы: значение на каждую колонку по её key.
   * Первая колонка — подпись (по умолчанию «Итого»). Колонки, которых
   * нет в footer, остаются пустыми.
   */
  footer?: Record<string, ReactNode>;
}) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <h3 className="font-bold text-navy-900">{title}</h3>
      {hint && <p className="mt-0.5 mb-3 text-xs text-navy-600">{hint}</p>}
      {rows.length === 0 ? (
        <EmptyRows text={emptyText} />
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
                <tr
                  key={rowKey(r)}
                  className="border-b border-navy-50 transition-colors last:border-0 hover:bg-navy-50/70"
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`py-2.5 pr-3 align-middle ${
                        c.align === 'right' ? 'text-right tabular-nums' : ''
                      }`}
                    >
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer && (
              <tfoot>
                <tr
                  data-testid="итого"
                  className="border-t-2 border-navy-200 bg-navy-50/70 font-bold text-navy-900"
                >
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={`py-2 pr-3 ${
                        c.align === 'right' ? 'text-right tabular-nums' : ''
                      }`}
                    >
                      {footer[c.key] ?? (i === 0 ? 'Итого' : '')}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </ScrollArea>
      )}
    </div>
  );
}

/**
 * `embedded` — аналитика показана вкладкой внутри раздела «Финансы»:
 * заголовок и «Назад» рисует та страница, здесь остаются подпись
 * периода и переключатель.
 */
export function Analytics({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const seesAll = userSeesAll(user);
  // подписи сумм над столбиками помещаются только на широком экране
  const wide = useWideScreen();
  // деньги в аналитике — по праву на финансы (руководитель и управляющий
  // без личного запрета), а не по роли: то же правило, что у книги
  const isDirector = userSeesFinance(user);
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
  // лидеры таблиц — отмечаются звёздочкой; без денег лидер по количеству
  const leadManager = leaderOf(bd?.managers, (r) => r.amount || r.paid)?.id ?? null;
  const leadService = leaderOf(bd?.services, (r) => r.amount || r.count)?.key;
  const leadExtra = leaderOf(bd?.extras, (r) => r.amount || r.count)?.key;
  const leadCleaner = leaderOf(bd?.cleaners, (r) => r.accrued || r.shifts)?.id;
  const leadClient = leaderOf(bd?.clients, (r) => r.amount || r.count)?.id;
  const leadKpi = leaderOf(data?.managerKpi, (r) => r.amount || r.paid)?.id ?? null;

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
    <div className="animate-page-in zone-live">
      {embedded ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-navy-600">
            {seesAll ? `Аналитика компании · ${rangeLabel}` : `Аналитика по вашим заказам · ${rangeLabel}`}
          </p>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
      ) : (
        <PageHeader
          title="Аналитика и отчёты"
          subtitle={seesAll ? `Аналитика компании · ${rangeLabel}` : `Аналитика по вашим заказам · ${rangeLabel}`}
          action={<PeriodFilter value={period} onChange={setPeriod} />}
        />
      )}

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
          <div className="mb-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
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

          {/*
            Первый ряд — деньги и зарплаты: то, на что руководитель смотрит
            первым (решение владельца). Приходит только тем, кому открыты
            финансы. Второй ряд — счётчики, компактно.
          */}
          {data.revenue && (
            <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              <StatTile
                label="Выручка"
                number={data.revenue.period}
                format={formatPrice}
                icon={Wallet}
                accent="green"
                hint={rangeLabel}
                title="Из каких заказов сложилась выручка периода"
                testId="плитка-выручка"
                onClick={() =>
                  setDrill({
                    title: 'Выручка за период',
                    subtitle: rangeLabel,
                    metric: 'revenuePeriod',
                  })
                }
              />
              {/*
                Чистый доход: выручка минус все расходы из книги за период.
                Рисуется только когда сервер уже отдаёт цифру — сайт и сервер
                выкатываются порознь.
              */}
              {data.revenue.net != null && (
                <StatTile
                  label="Чистый доход"
                  number={data.revenue.net}
                  format={formatPrice}
                  icon={TrendingUp}
                  accent={data.revenue.net >= 0 ? 'green' : 'red'}
                  hint={`выручка − расходы ${formatPrice(data.revenue.expenses)}`}
                  title="Выручка минус расходы: из чего сложился чистый доход"
                  testId="плитка-чистый"
                  onClick={() =>
                    setDrill({
                      title: 'Чистый доход — из чего сложился',
                      subtitle: rangeLabel,
                      metric: 'expenses',
                      mode: 'entries',
                      net: true,
                    })
                  }
                />
              )}
              {data.payroll && (
                <StatTile
                  label="ЗП клинеров"
                  number={data.payroll.cleanersAccrued}
                  format={formatPrice}
                  icon={HardHat}
                  accent="amber"
                  hint="начислено по сменам"
                  title="Выезды периода: кто работал и сколько начислено"
                  testId="плитка-зп-клинеров"
                  onClick={() =>
                    setDrill({
                      title: 'ЗП клинеров — выезды за период',
                      subtitle: rangeLabel,
                      metric: 'brigadeVisits',
                      mode: 'visits',
                    })
                  }
                />
              )}
              {data.payroll && (
                <StatTile
                  label="ЗП и премии сотрудников"
                  number={data.payroll.staffPay}
                  format={formatPrice}
                  icon={Users}
                  accent="violet"
                  hint="статьи «Зарплата» и «Премии» в книге"
                  title="Операции по статьям «Зарплата» и «Премии» за период"
                  testId="плитка-зп-сотрудников"
                  onClick={() =>
                    setDrill({
                      title: 'ЗП и премии сотрудников',
                      subtitle: rangeLabel,
                      metric: 'expenses',
                      mode: 'entries',
                      categories: ['SALARY', 'BONUS'],
                    })
                  }
                />
              )}
              <StatTile
                label="Все расходы"
                number={data.revenue.expenses}
                format={formatPrice}
                icon={ArrowDownRight}
                accent="red"
                hint="из книги за период"
                title="Все расходы книги за период — они вычитаются в чистом доходе"
                testId="плитка-расходы"
                onClick={() =>
                  setDrill({
                    title: 'Все расходы за период',
                    subtitle: rangeLabel,
                    metric: 'expenses',
                    mode: 'entries',
                  })
                }
              />
              <StatTile
                label="Средний чек"
                number={bd?.totals.average ?? 0}
                format={formatPrice}
                icon={Receipt}
                accent="brand"
                hint="выручка ÷ оплаченные заказы"
                title="Из каких заказов сложился средний чек"
                testId="плитка-средний-чек"
                onClick={() =>
                  setDrill({
                    title: 'Средний чек — из чего сложился',
                    subtitle: rangeLabel,
                    metric: 'revenuePeriod',
                  })
                }
              />
            </div>
          )}

          {/* Второй ряд: счётчики — компактные плитки */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {bd && (
              <StatTile
                size="sm"
                label="Оплаченных заказов"
                number={bd.totals.paidOrders}
                icon={CheckCircle2}
                accent="green"
                title="Заказы, оплаченные за выбранный период"
                testId="плитка-оплачено"
                onClick={() =>
                  setDrill({
                    title: 'Оплаченные заказы',
                    subtitle: rangeLabel,
                    metric: 'revenuePeriod',
                  })
                }
              />
            )}
            <StatTile
              size="sm"
              label="Всего обращений"
              number={data.conversion.total}
              icon={Inbox}
              accent="brand"
              title="Все обращения за период"
              testId="плитка-обращений"
              onClick={() =>
                setDrill({
                  title: 'Все обращения за период',
                  subtitle: rangeLabel,
                  metric: 'conversionTotal',
                })
              }
            />
            <StatTile
              size="sm"
              label="Отказы"
              number={data.conversion.rejected}
              icon={XCircle}
              accent="red"
              title="Кто отказался и почему"
              testId="плитка-отказы"
              onClick={() =>
                setDrill({
                  title: 'Отказы за период',
                  subtitle: rangeLabel,
                  metric: 'conversionRejected',
                })
              }
            />
            {data.revenue && bd && (
              <StatTile
                size="sm"
                label="Скидки"
                number={bd.totals.discountTotal}
                format={formatPrice}
                icon={Percent}
                accent="amber"
                title="Заказы, по которым дали скидку"
                testId="плитка-скидки"
                onClick={() =>
                  setDrill({
                    title: 'Скидки за период',
                    subtitle: rangeLabel,
                    metric: 'revenuePeriod',
                  })
                }
              />
            )}
            {data.revenue && bd && (
              <StatTile
                size="sm"
                label="Доп. услуги"
                number={bd.totals.extrasRevenue}
                format={formatPrice}
                icon={Sparkles}
                accent="violet"
                title="Какие доп. услуги брали за период"
                testId="плитка-доп-услуги"
                onClick={() =>
                  setDrill({
                    title: 'Доп. услуги за период',
                    subtitle: rangeLabel,
                    // только заказы, где доп. услуги есть, — а не вся выручка
                    metric: 'extrasAllOrders',
                  })
                }
              />
            )}
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {/* Доход по дням — финансы, только руководителю */}
            {data.revenueSeries && (
              <div className="card min-w-0 overflow-hidden p-5 lg:col-span-2">
                <h3 className="mb-1 font-bold text-navy-900">Доход за 14 дней: выручка и чистый</h3>
                <p className="mb-3 text-xs text-navy-600">{HINT}</p>
                <ResponsiveContainer width="100%" height={260}>
                  {/*
                    Столбик «Чистый доход» не уходит ниже нуля (решение
                    владельца): в день без выручки, но с расходами (зарплата,
                    аренда) он равен 0, а не тянет ось в минус. Сам расчёт
                    не трогаем — плитка и итог за период считаются как прежде;
                    расходы дня видны в подсказке при наведении.
                  */}
                  <BarChart
                    data={data.revenueSeries.map((d) => ({
                      ...d,
                      netShown: Math.max(0, d.net),
                    }))}
                    margin={{ top: 18, right: 8, left: 0, bottom: 0 }}
                    barCategoryGap={barGap(wide)}
                  >
                    {chartGradients()}
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, 'auto']}
                      allowDataOverflow
                    />
                    <Tooltip cursor={CURSOR_FILL} content={<RevenueDayTooltip />} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="revenue"
                      name="Выручка"
                      fill={gradient('blue')}
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      {...BAR_ANIMATION}
                      onClick={(bar: any) =>
                        bar?.payload?.day &&
                        setDrill({
                          title: `Оплачено ${formatDateTz(bar.payload.day)}`,
                          subtitle: 'Заказы, закрытые в этот день',
                          metric: 'revenueDay',
                          key: bar.payload.day,
                        })
                      }
                    >
                      {wide && <LabelList dataKey="revenue" {...valueLabel()} />}
                    </Bar>
                    {/* чистый доход дня: выручка минус расходы книги за этот день */}
                    <Bar
                      dataKey="netShown"
                      name="Чистый доход"
                      fill={gradient('green')}
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      {...BAR_ANIMATION}
                      onClick={(bar: any) =>
                        bar?.payload?.day &&
                        setDrill({
                          title: `Оплачено ${formatDateTz(bar.payload.day)}`,
                          subtitle: 'Заказы, закрытые в этот день',
                          metric: 'revenueDay',
                          key: bar.payload.day,
                        })
                      }
                    >
                      {/* подпись только у выручки: две цифры над парой узких
                          столбиков наезжали друг на друга; чистый — в подсказке */}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}


            {/* Источники заявок — за выбранный период; во всю ширину: соседний график убран */}
            <div className="card min-w-0 overflow-hidden p-5 lg:col-span-2">
              <h3 className="mb-1 font-bold text-navy-900">Источники заявок</h3>
              <p className="mb-3 text-xs text-navy-600">{HINT}</p>
              {data.sources.length === 0 ? (
                <p className="py-10 text-center text-sm text-navy-600">
                  За период заявок не было
                </p>
              ) : (
                <Donut
                  data={data.sources}
                  dataKey="count"
                  nameKey="label"
                  caption="заявок"
                  unit="заявок"
                  onSelect={(s) =>
                    s.source &&
                    setDrill({
                      title: `Источник: ${s.label}`,
                      subtitle: `Заявки с этого источника · ${rangeLabel}`,
                      metric: 'source',
                      key: String(s.source),
                    })
                  }
                />
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
                  footer={{
                    name: 'Итого',
                    total: sumBy(bd.managers, (r) => r.total),
                    paid: sumBy(bd.managers, (r) => r.paid),
                    amount: formatPrice(sumBy(bd.managers, (r) => r.amount)),
                    // общий средний чек: вся сумма ÷ все оплаченные, а не среднее из средних
                    average: formatPrice(
                      avgOf(
                        sumBy(bd.managers, (r) => r.amount),
                        sumBy(bd.managers, (r) => r.paid),
                      ),
                    ),
                  }}
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
                          <NameCell name={r.name} leader={(r.id ?? null) === leadManager} />
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
                          <span className="inline-flex items-center gap-1.5">
                            {r.paid}
                            <LevelBadge pct={r.total ? Math.round((r.paid / r.total) * 100) : 0} />
                          </span>
                        </DrillValue>
                      ),
                    },
                    ...(isDirector
                      ? [
                          {
                            key: 'amount',
                            header: 'Сумма',
                            align: 'right' as const,
                            cell: (r: typeof bd.managers[number]) => (
                              <ShareCell
                                value={r.amount}
                                total={sumBy(bd.managers, (x) => x.amount)}
                                color="brand"
                              />
                            ),
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

                {/*
                  Узкие таблицы (три колонки) — парами в два столбца (решение
                  владельца): во всю ширину они выглядели пустыми. «Менеджеры»
                  и «KPI» с их колонками остаются во всю ширину. На планшете и
                  телефоне пары снова встают в столбик.
                */}
                <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                  <BreakdownCard
                    title="Услуги за период"
                    hint="По оплаченным заказам"
                    rows={bd.services}
                    rowKey={(r) => r.key}
                    emptyText="Оплаченных заказов за период нет"
                    footer={{
                      label: 'Итого',
                      count: sumBy(bd.services, (r) => r.count),
                      amount: formatPrice(sumBy(bd.services, (r) => r.amount)),
                    }}
                    columns={[
                      {
                        key: 'label',
                        header: 'Услуга',
                        cell: (r) => <NameCell name={r.label} icon={Brush} leader={r.key === leadService} />,
                      },
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
                              cell: (r: typeof bd.services[number]) => (
                                <ShareCell
                                  value={r.amount}
                                  total={sumBy(bd.services, (x) => x.amount)}
                                  color="green"
                                />
                              ),
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
                    footer={{
                      label: 'Итого',
                      count: sumBy(bd.extras, (r) => r.count),
                      amount: formatPrice(sumBy(bd.extras, (r) => r.amount)),
                    }}
                    columns={[
                      {
                        key: 'label',
                        header: 'Услуга',
                        cell: (r) => <NameCell name={r.label} icon={Sparkles} leader={r.key === leadExtra} />,
                      },
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
                              cell: (r: typeof bd.extras[number]) => (
                                <ShareCell
                                  value={r.amount}
                                  total={sumBy(bd.extras, (x) => x.amount)}
                                  color="violet"
                                />
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />

                </div>

                <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                  <BreakdownCard
                    title="Клинеры за период"
                    hint={
                      bd.cleanersTotal && bd.cleanersTotal.cleaners > bd.cleaners.length
                        ? `Кто сколько отработал смен · показаны ${bd.cleaners.length} из ${bd.cleanersTotal.cleaners}`
                        : 'Кто сколько отработал смен'
                    }
                    rows={bd.cleaners}
                    rowKey={(r) => r.id}
                    emptyText="Смен за период не было"
                    footer={{
                      name: `Итого · клинеров: ${bd.cleanersTotal?.cleaners ?? bd.cleaners.length}`,
                      shifts: bd.cleanersTotal?.shifts ?? sumBy(bd.cleaners, (r) => r.shifts),
                      accrued: formatPrice(
                        bd.cleanersTotal?.accrued ?? sumBy(bd.cleaners, (r) => r.accrued),
                      ),
                    }}
                    columns={[
                      {
                        key: 'name',
                        header: 'Клинер',
                        cell: (r) => <NameCell name={r.name} leader={r.id === leadCleaner} />,
                      },
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
                              cell: (r: typeof bd.cleaners[number]) => (
                                <ShareCell
                                  value={r.accrued}
                                  total={bd.cleanersTotal?.accrued ?? sumBy(bd.cleaners, (x) => x.accrued)}
                                  color="amber"
                                />
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />

                  <BreakdownCard
                    title="Клиенты за период"
                    hint={
                      bd.clientsTotal && bd.clientsTotal.clients > bd.clients.length
                        ? `Топ по оплаченным заказам · показаны ${bd.clients.length} из ${bd.clientsTotal.clients}`
                        : 'Топ по оплаченным заказам'
                    }
                    rows={bd.clients}
                    rowKey={(r) => r.id}
                    emptyText="Оплаченных заказов за период нет"
                    footer={{
                      name: `Итого · клиентов: ${bd.clientsTotal?.clients ?? bd.clients.length}`,
                      count: bd.clientsTotal?.count ?? sumBy(bd.clients, (r) => r.count),
                      amount: formatPrice(
                        bd.clientsTotal?.amount ?? sumBy(bd.clients, (r) => r.amount),
                      ),
                    }}
                    columns={[
                      {
                        key: 'name',
                        header: 'Клиент',
                        cell: (r) => <NameCell name={r.name} leader={r.id === leadClient} />,
                      },
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
                              cell: (r: typeof bd.clients[number]) => (
                                <ShareCell
                                  value={r.amount}
                                  total={bd.clientsTotal?.amount ?? sumBy(bd.clients, (x) => x.amount)}
                                  color="brand"
                                />
                              ),
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
                      <KpiTotalCard rows={data.managerKpi} seesAll={seesAll} />
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
                              className="border-b border-navy-50 transition-colors last:border-0 hover:bg-navy-50/70"
                            >
                              <td className="py-2 pr-3">
                                <NameCell name={m.name} leader={(m.id ?? null) === leadKpi} />
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">{m.calls}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-sky-700">{m.cold}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-amber-700">{m.neutral}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-red-700">{m.hot}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{m.newClients}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{m.orders}</td>
                              <td className="py-2 pr-3 text-right tabular-nums font-semibold">{m.paid}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{m.rejected}</td>
                              <td className="py-2 pr-3 text-right">
                                <LevelBadge pct={m.conversion} />
                              </td>
                              {seesAll && (
                                <td className="py-2 text-right">
                                  <ShareCell
                                    value={m.amount}
                                    total={sumBy(data.managerKpi ?? [], (x) => x.amount)}
                                    color="brand"
                                  />
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <KpiTotalRow rows={data.managerKpi} seesAll={seesAll} />
                        </tfoot>
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
                    <BarChart
                      data={data.managerWorkload}
                      margin={{ top: 18, right: 8, left: 0, bottom: 0 }}
                      barCategoryGap={barGap(wide)}
                    >
                      {chartGradients()}
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#5fb1e8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={CURSOR_FILL}
                        content={<ChartTooltip colors={{ active: CHART.blue, paid: CHART.sky }} />}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="active"
                        name="Активные заказы"
                        fill={gradient('blue')}
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        {...BAR_ANIMATION}
                        onClick={(bar: any) =>
                          bar?.payload &&
                          setDrill({
                            title: `${bar.payload.name} — в работе`,
                            subtitle: 'Заказы, которые сейчас на этом сотруднике',
                            metric: 'managerActive',
                            key: bar.payload.id || 'none',
                          })
                        }
                      >
                        {wide && <LabelList dataKey="active" {...valueLabel(String)} />}
                      </Bar>
                      <Bar
                        dataKey="paid"
                        name="Завершено"
                        fill={gradient('sky')}
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        {...BAR_ANIMATION}
                        onClick={(bar: any) =>
                          bar?.payload &&
                          setDrill({
                            title: `${bar.payload.name} — доведено до оплаты`,
                            subtitle: 'Все оплаченные заказы этого сотрудника',
                            metric: 'managerPaid',
                            key: bar.payload.id || 'none',
                          })
                        }
                      >
                        {wide && <LabelList dataKey="paid" {...valueLabel(String)} />}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {drill &&
        (drill.mode === 'entries' ? (
          <EntriesDrillModal
            title={drill.title}
            subtitle={drill.subtitle}
            from={period.from}
            to={period.to}
            categories={drill.categories}
            summary={
              drill.net && data?.revenue
                ? {
                    revenue: data.revenue.period,
                    expenses: data.revenue.expenses,
                    net: data.revenue.net,
                  }
                : undefined
            }
            onClose={() => setDrill(null)}
          />
        ) : drill.mode === 'visits' || drill.mode === 'shifts' ? (
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
/** Сумма колонки — для строки «Итого» под таблицей */
function sumBy<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0);
}

/** Общий средний чек: вся сумма ÷ все заказы, а не среднее из средних */
function avgOf(amount: number, count: number): number {
  return count ? Math.round(amount / count) : 0;
}

type KpiRow = NonNullable<AnalyticsFull['managerKpi']>[number];

/**
 * Итог KPI по всем сотрудникам. Конверсия — общая (все оплаты ÷ все
 * заявки), той же формулой, что у строки сотрудника на сервере.
 */
function kpiTotals(rows: KpiRow[]) {
  const t = {
    calls: sumBy(rows, (r) => r.calls),
    cold: sumBy(rows, (r) => r.cold),
    neutral: sumBy(rows, (r) => r.neutral),
    hot: sumBy(rows, (r) => r.hot),
    newClients: sumBy(rows, (r) => r.newClients),
    orders: sumBy(rows, (r) => r.orders),
    paid: sumBy(rows, (r) => r.paid),
    rejected: sumBy(rows, (r) => r.rejected),
    amount: sumBy(rows, (r) => r.amount),
  };
  return { ...t, conversion: t.orders ? Math.round((t.paid / t.orders) * 100) : 0 };
}

function KpiTotalRow({ rows, seesAll }: { rows: KpiRow[]; seesAll: boolean }) {
  const t = kpiTotals(rows);
  const cell = 'py-2 pr-3 text-right tabular-nums';
  return (
    <tr
      data-testid="итого"
      className="border-t-2 border-navy-200 bg-navy-50/70 font-bold text-navy-900"
    >
      <td className="py-2 pr-3">Итого</td>
      <td className={cell}>{t.calls}</td>
      <td className={`${cell} text-sky-700`}>{t.cold}</td>
      <td className={`${cell} text-amber-700`}>{t.neutral}</td>
      <td className={`${cell} text-red-700`}>{t.hot}</td>
      <td className={cell}>{t.newClients}</td>
      <td className={cell}>{t.orders}</td>
      <td className={cell}>{t.paid}</td>
      <td className={cell}>{t.rejected}</td>
      <td className={`${cell} text-brand-600`}>{t.conversion}%</td>
      {seesAll && <td className="py-2 text-right tabular-nums">{formatPrice(t.amount)}</td>}
    </tr>
  );
}

function KpiTotalCard({ rows, seesAll }: { rows: KpiRow[]; seesAll: boolean }) {
  const t = kpiTotals(rows);
  return (
    <div
      data-testid="итого"
      className="rounded-xl border-2 border-navy-200 bg-navy-50/70 p-3 font-semibold text-navy-900"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span>Итого</span>
        <span className="text-sm font-bold tabular-nums text-brand-600">{t.conversion}%</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <KpiCell label="Звонки" value={t.calls} />
        <KpiCell label="Хол · Нейтр · Гор" value={`${t.cold} · ${t.neutral} · ${t.hot}`} />
        <KpiCell label="Новых клиентов" value={t.newClients} />
        <KpiCell label="Заявок" value={t.orders} />
        <KpiCell label="Оплачено" value={t.paid} />
        <KpiCell label="Отказов" value={t.rejected} />
        {seesAll && <KpiCell label="Продано" value={formatPrice(t.amount)} />}
      </dl>
    </div>
  );
}

/**
 * Подсказка к столбику дня: выручка, расходы из книги и чистый доход.
 * Расходы показываем отдельной строкой, потому что столбик их не рисует —
 * иначе день с одной зарплатой выглядел бы как «ничего не было».
 */
function RevenueDayTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload?: { revenue: number; expense: number; net: number } }[];
  label?: string;
}) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div className="rounded-lg border border-navy-100 bg-white px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-semibold text-navy-900">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-navy-600">Выручка</span>
        <span className="tabular-nums text-brand-600">{formatPrice(d.revenue)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-navy-600">Расходы</span>
        <span className="tabular-nums text-red-700">{formatPrice(d.expense)}</span>
      </div>
      <div className="flex justify-between gap-4 font-semibold">
        <span className="text-navy-600">Чистый доход</span>
        <span className="tabular-nums text-emerald-700">{formatPrice(Math.max(0, d.net))}</span>
      </div>
    </div>
  );
}

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
