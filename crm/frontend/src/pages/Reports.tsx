import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FileText, ChevronRight, Send, CheckCircle2 } from 'lucide-react';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Spinner, PageHeader, Badge, EmptyState } from '../components/ui';
import {
  DrillValue,
  DetailModal,
  DetailStats,
  DetailTabs,
  DetailTable,
} from '../components/Drilldown';
import {
  REPORT_STATUS_LABEL,
  REPORT_STATUS_COLOR,
  formatPrice,
  formatDate,
} from '../lib/labels';
import type { Report } from '../types';

/** Сумма выплат работникам по ведомости */
export function workersTotal(r: Report): number {
  return r.workers.reduce(
    (s, w) => s + w.days * w.rate - w.fine + w.extra,
    0,
  );
}

/** Сумма доп. расходов по ведомости */
export function expensesTotal(r: Report): number {
  return r.expenses.reduce((s, e) => s + e.amount, 0);
}

export function Reports() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDirector = user?.role === 'DIRECTOR';
  const { data, loading } = useFetch<Report[]>('/reports', { pollMs: 20000 });
  const [drill, setDrill] = useState<{ report: Report; tab: ReportDetailTab } | null>(null);

  if (loading || !data) return <Spinner />;

  const waiting = isDirector ? data.filter((r) => r.status === 'SENT').length : 0;

  return (
    <div>
      <PageHeader
        title="Отчёты"
        action={
          <button onClick={() => navigate('/reports/new')} className="btn-primary">
            <Plus className="h-4 w-4" />
            Новый отчёт
          </button>
        }
      />

      {data.length === 0 ? (
        <EmptyState text="Отчётов пока нет — создайте первый по кнопке «Новый отчёт»" />
      ) : (
        <div className="space-y-3">
          {data.map((r) => (
            <Link
              key={r.id}
              to={`/reports/${r.id}`}
              /*
               * На телефоне карточка раскладывается по строкам, на компьютере
               * остаётся одним рядом.
               *
               * Одним рядом на узком экране блоку с именем оставалось около
               * девяноста пикселей: «Сабрина» разрывалась на «Сабрин / а», а
               * строка «выплаты … · расходы …» была шире своей колонки и
               * наезжала на соседей. Сетка даёт имени всю ширину, а суммам —
               * отдельную строку.
               */
              className="card grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 p-4 transition-shadow hover:shadow-lg sm:flex sm:flex-nowrap sm:gap-4"
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  r.status === 'ACCEPTED'
                    ? 'bg-green-100 text-green-700'
                    : r.status === 'SENT'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-navy-100 text-navy-600'
                }`}
              >
                {r.status === 'ACCEPTED' ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : r.status === 'SENT' ? (
                  <Send className="h-5 w-5" />
                ) : (
                  <FileText className="h-5 w-5" />
                )}
              </span>

              <div className="min-w-0 sm:flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="no-vertical-text font-semibold text-navy-900">
                    {r.clientName}
                  </span>
                  <Badge className={REPORT_STATUS_COLOR[r.status]}>
                    {REPORT_STATUS_LABEL[r.status]}
                  </Badge>
                </div>
                <div className="no-vertical-text mt-0.5 text-xs text-navy-600">
                  {r.workDate ? formatDate(r.workDate) : formatDate(r.createdAt)}
                  {r.address && ` · ${r.address}`}
                  {isDirector && r.managerName && ` · ${r.managerName}`}
                </div>
              </div>

              {/*
                Стрелка идёт в разметке перед суммами, чтобы в сетке попасть
                в первую строку рядом с именем. В ряду на компьютере порядок
                прежний — order-last возвращает её в конец.
              */}
              <ChevronRight className="h-4 w-4 shrink-0 text-navy-600 sm:order-last" />

              {/*
               * Карточка целиком — ссылка на отчёт, поэтому суммы открывают
               * расшифровку через stopPropagation + preventDefault: клик по
               * цифре показывает разбивку, не уводя со списка.
               */}
              <div
                className="col-span-3 text-right text-sm sm:ml-auto"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <DrillValue
                  align="right"
                  tone="strong"
                  title="Из чего сложилась сумма по ведомости"
                  onClick={() => setDrill({ report: r, tab: 'workers' })}
                >
                  {formatPrice(r.totalPrice)}
                </DrillValue>
                <div className="text-xs text-navy-600">
                  выплаты{' '}
                  <DrillValue
                    tone="muted"
                    className="text-xs"
                    disabled={r.workers.length === 0}
                    title="Кто сколько дней отработал"
                    onClick={() => setDrill({ report: r, tab: 'workers' })}
                  >
                    {formatPrice(workersTotal(r))}
                  </DrillValue>
                  {expensesTotal(r) > 0 && (
                    <>
                      {' · расходы '}
                      <DrillValue
                        tone="muted"
                        className="text-xs"
                        title="Какие расходы вошли в ведомость"
                        onClick={() => setDrill({ report: r, tab: 'expenses' })}
                      >
                        {formatPrice(expensesTotal(r))}
                      </DrillValue>
                    </>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {drill && (
        <ReportBreakdownModal
          report={drill.report}
          initialTab={drill.tab}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// ───────────── Расшифровка ведомости ─────────────

type ReportDetailTab = 'workers' | 'expenses';

/**
 * Из чего сложились суммы по ведомости: по каждому работнику — дни, ставка,
 * штраф и доплата, по расходам — что и от кого. Открывается прямо из списка,
 * чтобы сверить цифру, не заходя в сам отчёт.
 */
function ReportBreakdownModal({
  report,
  initialTab,
  onClose,
}: {
  report: Report;
  initialTab: ReportDetailTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ReportDetailTab>(initialTab);
  const workers = workersTotal(report);
  const expenses = expensesTotal(report);

  return (
    <DetailModal
      title={report.clientName}
      subtitle={[
        report.workDate ? formatDate(report.workDate) : formatDate(report.createdAt),
        report.address,
        report.brigadierName ? `бригадир: ${report.brigadierName}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      onClose={onClose}
    >
      <DetailStats
        items={[
          { label: 'Сумма работ', value: formatPrice(report.totalPrice) },
          { label: 'Выплаты', value: formatPrice(workers), tone: 'danger' },
          { label: 'Расходы', value: formatPrice(expenses), tone: 'danger' },
          {
            label: 'Остаток',
            value: formatPrice(report.totalPrice - workers - expenses),
            tone: report.totalPrice - workers - expenses < 0 ? 'danger' : 'success',
          },
        ]}
      />

      <DetailTabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'workers' as const, label: `Работники · ${report.workers.length}` },
          { value: 'expenses' as const, label: `Расходы · ${report.expenses.length}` },
        ]}
      />

      {tab === 'workers' ? (
        <DetailTable
          rows={report.workers}
          rowKey={(w, i) => w.id ?? `${w.fullName}-${i}`}
          emptyText="В ведомости нет работников"
          columns={[
            {
              key: 'name',
              header: 'Работник',
              cell: (w) => (
                <div>
                  <div className="font-medium text-navy-900">{w.fullName}</div>
                  <div className="text-xs text-navy-600">{w.role}</div>
                </div>
              ),
            },
            {
              key: 'calc',
              header: 'Расчёт',
              cell: (w) => (
                <span className="text-navy-600">
                  {w.days} × {formatPrice(w.rate)}
                  {w.fine > 0 && ` − штраф ${formatPrice(w.fine)}`}
                  {w.extra > 0 && ` + доплата ${formatPrice(w.extra)}`}
                </span>
              ),
            },
            {
              key: 'total',
              header: 'К выплате',
              align: 'right',
              cell: (w) => (
                <span className="font-bold text-navy-900">
                  {formatPrice(w.days * w.rate - w.fine + w.extra)}
                </span>
              ),
            },
          ]}
          footer={
            report.workers.length > 0 ? (
              <tr className="border-t border-navy-100 font-bold text-navy-900">
                <td className="px-3 py-2" colSpan={2}>
                  Итого выплат
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPrice(workers)}</td>
              </tr>
            ) : undefined
          }
        />
      ) : (
        <DetailTable
          rows={report.expenses}
          rowKey={(e, i) => e.id ?? `${e.title}-${i}`}
          emptyText="Расходов по этой ведомости нет"
          columns={[
            {
              key: 'title',
              header: 'Расход',
              cell: (e) => (
                <div>
                  <div className="font-medium text-navy-900">{e.title}</div>
                  {e.comment && <div className="text-xs text-navy-600">{e.comment}</div>}
                </div>
              ),
            },
            {
              key: 'initiator',
              header: 'От кого',
              cell: (e) => <span className="text-navy-600">{e.initiator || '—'}</span>,
            },
            {
              key: 'amount',
              header: 'Сумма',
              align: 'right',
              cell: (e) => (
                <span className="font-medium text-rose-700">{formatPrice(e.amount)}</span>
              ),
            },
          ]}
          footer={
            report.expenses.length > 0 ? (
              <tr className="border-t border-navy-100 font-bold text-navy-900">
                <td className="px-3 py-2" colSpan={2}>
                  Итого расходов
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                  {formatPrice(expenses)}
                </td>
              </tr>
            ) : undefined
          }
        />
      )}
    </DetailModal>
  );
}
