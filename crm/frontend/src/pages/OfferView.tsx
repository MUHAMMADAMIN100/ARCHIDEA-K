import { Fragment, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Copy,
  Pencil,
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { useFetch, invalidate } from '../api/hooks';
import { Spinner, Badge, ErrorState } from '../components/ui';
import { ScrollArea } from '../components/ScrollArea';
import { PrintSheet } from '../components/common';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import {
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_STATUS_COLOR,
  formatPrice,
} from '../lib/labels';
import { formatDateTz, formatDateTimeTz } from '../lib/date';
import { printDocument } from '../lib/print';
import { ProposalEditModal } from '../components/ProposalEditModal';
import type { Proposal, ProposalStatus } from '../types';

/** Строки шапки печатного листа: клиент, адрес, объём и цена, скидка, срок, автор */
function headerRows(p: Proposal, volumeLabel: string): [string, string][] {
  const rows: [string, string][] = [
    ['Клиент', `${p.clientName}${p.clientPhone ? ` · ${p.clientPhone}` : ''}`],
    ['Адрес объекта', p.address || '—'],
    [
      'Объём и цена',
      p.pricePerSqm != null ? `${volumeLabel} × ${formatPrice(p.pricePerSqm)}` : volumeLabel,
    ],
  ];
  if (p.discount) rows.push(['Скидка', formatPrice(p.discount)]);
  rows.push(['Итоговая сумма', formatPrice(p.total)]);
  rows.push(['Действует до', p.validUntil ? formatDateTz(p.validUntil) : '—']);
  rows.push(['Подготовил', p.createdByName]);
  return rows;
}

export function OfferView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();

  const { data: p, loading, error, reload, setData } = useFetch<Proposal>(
    `/proposals/${id}`,
    { deps: [id] },
  );
  const [editing, setEditing] = useState(false);

  if (loading && !p) return <Spinner />;
  if (error || !p) {
    return (
      <div className="mx-auto max-w-4xl animate-page-in">
        <button
          onClick={() => navigate('/offers')}
          className="press mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
        >
          <ArrowLeft className="h-4 w-4" /> К списку
        </button>
        <ErrorState text={error || 'КП не найдено'} onRetry={reload} />
      </div>
    );
  }

  const fileName = `КП №${p.number} — ${p.clientName}.pdf`;

  const markSent = async () => {
    const ok = await dialog.confirm({
      title: `Отметить КП №${p.number} отправленным?`,
      message:
        'Фиксируется, кто и когда отправил КП клиенту. Если у КП есть заказ на раннем этапе, он перейдёт на этап «Коммерческое предложение». Клиенту файл нужно отправить вручную — сначала скачайте PDF.',
      confirmText: 'Отметить отправленным',
    });
    if (!ok) return;

    const before = p;
    setData((prev) =>
      prev
        ? {
            ...prev,
            status: 'SENT' as ProposalStatus,
            sentAt: new Date().toISOString(),
          }
        : prev,
    );
    toast.success('КП отмечено отправленным');
    try {
      const updated = (await api.post<Proposal>(`/proposals/${p.id}/send`, {})).data;
      setData(updated);
      invalidate('/proposals');
      if (p.orderId) invalidate('/orders');
    } catch (e: any) {
      setData(before);
      toast.error(e?.response?.data?.message || 'Не удалось отметить КП отправленным');
    }
  };

  const changeStatus = async (next: 'ACCEPTED' | 'REJECTED') => {
    const before = p;
    setData((prev) => (prev ? { ...prev, status: next } : prev));
    toast.success(next === 'ACCEPTED' ? 'КП принято клиентом' : 'КП отклонено');
    try {
      const updated = (
        await api.patch<Proposal>(`/proposals/${p.id}/status`, { status: next })
      ).data;
      setData(updated);
      invalidate('/proposals');
    } catch (e: any) {
      setData(before);
      toast.error(e?.response?.data?.message || 'Не удалось изменить статус КП');
    }
  };

  const removeProposal = async () => {
    const ok = await dialog.confirm({
      title: `Удалить КП №${p.number}?`,
      message: `КП для «${p.clientName}» будет перенесено в корзину. Восстановить его можно в разделе «Корзина».`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/proposals/${p.id}`);
      toast.success('КП перенесено в корзину');
      invalidate('/proposals');
      navigate('/offers', { replace: true });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить КП');
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(p.bodySnapshot);
      toast.success('Текст КП скопирован в буфер обмена');
    } catch {
      toast.error('Не удалось скопировать текст — скопируйте вручную');
    }
  };

  const items = p.items ?? [];
  const volumeLabel = p.area != null ? `${p.area} м²` : '—';

  return (
    <div className="mx-auto max-w-4xl animate-page-in">
      {/* ── Панель действий (не печатается) ── */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate('/offers')}
          className="press inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
        >
          <ArrowLeft className="h-4 w-4" /> К списку
        </button>
        <div className="flex flex-wrap gap-2">
          <button onClick={copyText} className="btn-ghost">
            <Copy className="h-4 w-4" />
            Скопировать текст
          </button>
          <button onClick={() => printDocument(fileName)} className="btn-ghost">
            <Download className="h-4 w-4" />
            Скачать PDF
          </button>
          {/*
            Правка КП (ТЗ 9). Сервер умел это с самого начала, а из интерфейса
            было невозможно: ошибся в цифре — заводи предложение заново.
          */}
          <button onClick={() => setEditing(true)} className="btn-ghost">
            <Pencil className="h-4 w-4" />
            Изменить
          </button>
          {p.status === 'DRAFT' && (
            <button onClick={markSent} className="btn-primary">
              <Send className="h-4 w-4" />
              Отметить отправленным
            </button>
          )}
          {p.status === 'SENT' && (
            <>
              <button
                onClick={() => changeStatus('ACCEPTED')}
                className="press inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                Принято
              </button>
              <button
                onClick={() => changeStatus('REJECTED')}
                className="press inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
              >
                <XCircle className="h-4 w-4" />
                Отклонено
              </button>
            </>
          )}
          <button
            onClick={removeProposal}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Кто и когда отправил — служебная информация, в печать не идёт */}
      {p.sentAt && (
        <div className="no-print mb-3 text-xs text-navy-600">
          Отправлено {p.sentByName} · {formatDateTimeTz(p.sentAt)}
        </div>
      )}

      {/* ── КП (печатается) ── */}
      <PrintSheet
        title={`ARCHIDEA · Коммерческое предложение №${p.number}`}
        subtitle={
          <div className="flex items-center gap-2">
            <span>от {formatDateTz(p.createdAt)}</span>
            <Badge className={`no-print ${PROPOSAL_STATUS_COLOR[p.status]}`}>
              {PROPOSAL_STATUS_LABEL[p.status]}
            </Badge>
          </div>
        }
      >
        {/* Шапка: клиент, адрес, объём и цена */}
        <div className="overflow-hidden rounded-xl border border-navy-200 text-sm">
          {headerRows(p, volumeLabel).map(([k, v], i) => (
            <div key={k} className={`flex ${i > 0 ? 'border-t border-navy-100' : ''}`}>
              <div className="w-2/5 shrink-0 bg-navy-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-navy-600">
                {k}
              </div>
              <div
                className={`flex-1 px-3 py-2 text-navy-900 ${
                  k === 'Итоговая сумма' ? 'font-bold' : ''
                }`}
              >
                {v}
              </div>
            </div>
          ))}
        </div>

        {/* Текст предложения — снимок текста на момент создания/правки */}
        {p.bodySnapshot && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-700">
              Текст предложения
            </h3>
            <p className="whitespace-pre-wrap rounded-xl bg-navy-50/60 p-4 text-sm leading-relaxed text-navy-800">
              {p.bodySnapshot}
            </p>
          </div>
        )}

        {/* Позиции сметы */}
        {items.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-700">
              Позиции
            </h3>
            {/*
              Растворяющийся край — сигнал «таблица шире экрана» для телефона.
              В PDF его гасим: на листе таблица помещается целиком, а признак
              прокрутки снимается с экранной раскладки и лёг бы белым пятном
              поверх колонки «Сумма».
            */}
            <ScrollArea
              axis="x"
              className="print:[&::before]:hidden print:[&::after]:hidden"
              label="Позиции сметы"
            >
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="bg-navy-500 text-left text-xs text-white print:bg-white print:text-navy-900">
                    <th className="border border-navy-300 px-2 py-1.5 font-semibold">№</th>
                    <th className="border border-navy-300 px-2 py-1.5 font-semibold">
                      Наименование
                    </th>
                    <th className="border border-navy-300 px-2 py-1.5 text-right font-semibold">
                      Объём
                    </th>
                    <th className="border border-navy-300 px-2 py-1.5 text-right font-semibold">
                      Цена за ед.
                    </th>
                    <th className="border border-navy-300 px-2 py-1.5 text-right font-semibold">
                      Сумма
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <Fragment key={i}>
                      {/*
                        Заголовок раздела печатается один раз перед его первой
                        позицией: клиент читает смету блоками — работы отдельно,
                        доп. услуги отдельно, — а не сплошным списком.
                      */}
                      {it.section && it.section !== items[i - 1]?.section && (
                        <tr className="bg-navy-100/70 print:bg-navy-50">
                          <td
                            className="border border-navy-200 px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-navy-700"
                            colSpan={5}
                          >
                            {it.section}
                          </td>
                        </tr>
                      )}
                    <tr>
                      <td className="border border-navy-200 px-2 py-1.5 text-navy-600">
                        {i + 1}
                      </td>
                      <td className="border border-navy-200 px-2 py-1.5 font-medium text-navy-900">
                        {it.title}
                      </td>
                      <td className="border border-navy-200 px-2 py-1.5 text-right text-navy-700">
                        {it.volume != null
                          ? `${it.volume}${it.unit ? ` ${it.unit}` : ''}`
                          : '—'}
                      </td>
                      <td className="border border-navy-200 px-2 py-1.5 text-right text-navy-700">
                        {it.unitPrice != null ? formatPrice(it.unitPrice) : '—'}
                      </td>
                      <td className="border border-navy-200 px-2 py-1.5 text-right font-bold text-navy-900">
                        {it.amount != null ? formatPrice(it.amount) : '—'}
                      </td>
                    </tr>
                    </Fragment>
                  ))}
                  <tr className="bg-navy-50 font-bold text-navy-900">
                    <td className="border border-navy-200 px-2 py-1.5" colSpan={4}>
                      Итого
                    </td>
                    <td className="border border-navy-200 px-2 py-1.5 text-right">
                      {formatPrice(p.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </ScrollArea>
          </div>
        )}

        {/* Подпись — только для печати */}
        <div className="mt-8 hidden justify-between gap-8 text-sm print:flex">
          <div>Подготовил: {p.createdByName}</div>
          <div>Подпись ____________________ дата ____________</div>
        </div>
      </PrintSheet>

      {editing && (
        <ProposalEditModal
          proposal={p}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            setData(() => updated);
            invalidate('/proposals');
          }}
        />
      )}
    </div>
  );
}
