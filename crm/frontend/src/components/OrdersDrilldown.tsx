import { useFetch } from '../api/hooks';
import { ErrorState } from './ui';
import { DetailModal, DetailStats, DetailTable } from './Drilldown';
import { formatPrice, STAGE_LABEL } from '../lib/labels';
import { formatDateTz } from '../lib/date';
import type { AnalyticsDrilldown } from '../types';

/**
 * Расшифровка любой цифры с экрана аналитики: столбика диаграммы, сектора
 * «источников», карточки выручки. Показывает те самые заказы, из которых
 * цифра сложилась, — с суммами, этапом и ответственным.
 *
 * Срез задаётся парой metric+key; считает его бэкенд тем же условием, что и
 * саму цифру, поэтому итог внизу всегда сходится с числом, по которому кликнули.
 */
export function OrdersDrilldownModal({
  title,
  subtitle,
  metric,
  drillKey,
  from,
  to,
  showMoney = true,
  onClose,
}: {
  title: string;
  subtitle?: string;
  metric: string;
  drillKey?: string;
  from?: string;
  to?: string;
  /** менеджеру суммы не показываем — их нет и в самой аналитике */
  showMoney?: boolean;
  onClose: () => void;
}) {
  const query = new URLSearchParams({ metric });
  if (drillKey) query.set('key', drillKey);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  /*
   * Пустой диапазон означает «всё время». Без явного признака сервер брал
   * текущий месяц, и расшифровка не сходилась с цифрой, по которой её
   * открыли, — а расхождение в аналитике убивает доверие ко всем числам.
   */
  if (!from && !to) query.set('period', 'all');

  const url = `/analytics/drilldown?${query.toString()}`;
  const { data, loading, error, reload } = useFetch<AnalyticsDrilldown>(url, {
    deps: [metric, drillKey, from, to],
  });

  return (
    <DetailModal title={title} subtitle={subtitle} onClose={onClose}>
      {error ? (
        <ErrorState text={error ?? undefined} onRetry={reload} />
      ) : (
        <>
          <DetailStats
            items={[
              { label: 'Заказов', value: data?.count ?? '…' },
              ...(showMoney
                ? [
                    {
                      label: 'На сумму',
                      value: data ? formatPrice(data.sum) : '…',
                      tone: 'success' as const,
                    },
                  ]
                : []),
            ]}
          />

          <DetailTable
            rows={data?.orders}
            loading={loading}
            rowKey={(o) => o.id}
            emptyText="За этот срез заказов нет"
            columns={[
              {
                key: 'client',
                header: 'Клиент',
                cell: (o) => (
                  <div>
                    <div className="font-medium text-navy-900">{o.client.fullName}</div>
                    <div className="text-xs text-navy-600">{o.client.phone}</div>
                  </div>
                ),
              },
              {
                key: 'what',
                header: 'Уборка',
                cell: (o) => (
                  <div>
                    <div className="text-navy-800">{o.typeLabel}</div>
                    <div className="text-xs text-navy-600">
                      {o.address || 'адрес не указан'}
                      {o.area > 0 ? ` · ${o.area} м²` : ''}
                    </div>
                  </div>
                ),
              },
              {
                key: 'stage',
                header: 'Этап',
                cell: (o) => (
                  <div>
                    <div className="text-navy-800">{STAGE_LABEL[o.stage] ?? o.stage}</div>
                    <div className="text-xs text-navy-600">
                      {o.sourceLabel} · {formatDateTz(o.closedAt ?? o.createdAt)}
                    </div>
                  </div>
                ),
              },
              {
                key: 'manager',
                header: 'Ответственный',
                cell: (o) => (
                  <span className="text-navy-600">{o.manager?.fullName ?? '—'}</span>
                ),
              },
              ...(showMoney
                ? [
                    {
                      key: 'price',
                      header: 'Сумма',
                      align: 'right' as const,
                      cell: (o: AnalyticsDrilldown['orders'][number]) =>
                        o.price > 0 ? (
                          formatPrice(o.price)
                        ) : (
                          <span
                            className="text-amber-600"
                            title="Сумма не проставлена — заказ не попадает в выручку"
                          >
                            не указана
                          </span>
                        ),
                    },
                  ]
                : []),
            ]}
            footer={
              data && data.orders.length > 0 && showMoney ? (
                <tr className="border-t border-navy-100 font-bold text-navy-900">
                  <td className="px-3 py-2" colSpan={4}>
                    Итого по срезу
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-700">
                    {formatPrice(data.sum)}
                  </td>
                </tr>
              ) : undefined
            }
          />

          {data && data.count >= 500 && (
            <p className="mt-2 text-xs text-amber-600">
              Показаны первые 500 заказов — сузьте период, чтобы увидеть остальные.
            </p>
          )}
        </>
      )}
    </DetailModal>
  );
}
