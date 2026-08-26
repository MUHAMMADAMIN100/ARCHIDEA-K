import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Image as ImageIcon,
  Copy,
  Pencil,
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { useFetch, invalidate, deleteRecord } from '../api/hooks';
import { Spinner, Badge, ErrorState } from '../components/ui';
import { OfferReceipt } from '../components/OfferReceipt';
import { toPng } from 'html-to-image';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { PROPOSAL_STATUS_LABEL, PROPOSAL_STATUS_COLOR } from '../lib/labels';
import { formatDateTz, formatDateTimeTz } from '../lib/date';
import { printDocument } from '../lib/print';
import { ProposalEditModal } from '../components/ProposalEditModal';
import type { Proposal, ProposalStatus } from '../types';

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
  const receiptRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  /*
   * Поля страницы при печати — нулевые: тогда браузер не печатает свои
   * шапку и подвал (адрес сайта, дату, «1/2»), и клиент получает чистый
   * лист. Правило @page нельзя привязать к странице, поэтому добавляем его
   * только пока открыт этот экран и убираем при уходе.
   */
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4; margin: 0; }';
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  /*
   * Картинка для мессенджера: тот же чек, что уходит в PDF, но PNG —
   * его удобнее кинуть клиенту с телефона. Рисуем в двойном разрешении,
   * чтобы на экране телефона текст не мылился.
   */
  const savePicture = async () => {
    const node = receiptRef.current;
    if (!node || !p) return;
    setSaving(true);
    try {
      const url = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `КП №${p.number} — ${p.clientName}.png`.replace(/[\\/:*?"<>|]+/g, ' ');
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('Картинка сохранена — можно отправить клиенту');
    } catch {
      toast.error('Не удалось собрать картинку, скачайте PDF');
    } finally {
      setSaving(false);
    }
  };

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
    await deleteRecord({
      remove: () => undefined,
      request: () => api.delete(`/proposals/${p.id}`),
      onDone: () => {
        toast.success('КП перенесено в корзину');
        navigate('/offers', { replace: true });
      },
      onFail: (m) => toast.error(m),
      refresh: ['/proposals'],
    });
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(p.bodySnapshot);
      toast.success('Текст КП скопирован в буфер обмена');
    } catch {
      toast.error('Не удалось скопировать текст — скопируйте вручную');
    }
  };


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
          <button onClick={savePicture} disabled={saving} className="btn-primary" data-testid="кнопка-картинка">
            <ImageIcon className="h-4 w-4" />
            {saving ? 'Собираю…' : 'Картинка для WhatsApp/Telegram'}
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

      {/* ── КП (печатается): фирменный чек, один лист ── */}
      <div className="offer-print-wrap flex flex-col items-center gap-3">
        <div className="no-print flex items-center gap-2 text-xs text-navy-600">
          <Badge className={PROPOSAL_STATUS_COLOR[p.status]}>{PROPOSAL_STATUS_LABEL[p.status]}</Badge>
          <span>Так КП увидит клиент — в PDF и на картинке</span>
        </div>
        <OfferReceipt ref={receiptRef} p={p} />
      </div>

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
