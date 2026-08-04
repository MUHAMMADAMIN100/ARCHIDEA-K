import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Pencil,
  Printer,
  Send,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { COMPANY, companyContacts } from '../lib/company';
import { useFetch, mutateCache } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Spinner, Badge } from '../components/ui';
import { ScrollArea } from '../components/ScrollArea';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import {
  REPORT_STATUS_LABEL,
  REPORT_STATUS_COLOR,
  formatPrice,
  formatDate,
} from '../lib/labels';
import type { Report } from '../types';

const workerSum = (w: { days: number; rate: number; fine: number; extra: number }) =>
  w.days * w.rate - w.fine + w.extra;

export function ReportView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { user } = useAuth();
  const isDirector = user?.role === 'DIRECTOR';

  const { data: r, loading, error, reload, setData } = useFetch<Report>(
    `/reports/${id}`,
    { deps: [id] },
  );

  if (loading) return <Spinner />;
  if (error || !r) {
    return (
      <div className="mx-auto max-w-4xl animate-page-in">
        <button
          onClick={() => navigate('/reports')}
          className="press mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
        >
          <ArrowLeft className="h-4 w-4" /> К списку
        </button>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 shadow-card">
          {error || 'Отчёт не найден'}
        </div>
      </div>
    );
  }

  const workersSum = r.workers.reduce((s, w) => s + workerSum(w), 0);
  const expensesSum = r.expenses.reduce((s, e) => s + e.amount, 0);
  /*
   * Чистый доход по объекту: выручка минус то, что по нему заплачено —
   * работникам и на дорогу. Именно эта цифра говорит, заработала компания
   * на уборке или отработала в ноль.
   */
  const netIncome = r.totalPrice - workersSum - expensesSum;
  const canEdit = r.status !== 'ACCEPTED';

  const sendReport = () => {
    // оптимистично: бейдж сразу становится «Отправлен», запрос — в фоне
    setData((rep) => (rep ? { ...rep, status: 'SENT' as Report['status'] } : rep));
    // и в кэше списка — чтобы при возврате статус был актуальным сразу
    mutateCache<Report[]>('/reports', (prev) =>
      prev.map((x) =>
        x.id === r.id ? { ...x, status: 'SENT' as Report['status'] } : x,
      ),
    );
    toast.success('Отчёт отправлен основателю');
    api.post(`/reports/${r.id}/send`).catch((e: any) => {
      toast.error(e?.response?.data?.message || 'Не удалось отправить отчёт');
      reload(); // вернуть актуальный статус с сервера
    });
  };

  const acceptReport = async () => {
    const ok = await dialog.confirm({
      title: 'Принять отчёт?',
      message:
        'Смены и штрафы работников из ведомости будут автоматически добавлены в «Смены и выплаты». Действие необратимо.',
      confirmText: 'Принять',
    });
    if (!ok) return;
    try {
      // без авто-повтора: принятие — необратимая операция, при сбое покажем
      // актуальное состояние (возможно, отчёт уже принят первым запросом)
      await api.post(`/reports/${r.id}/accept`);
      toast.success('Отчёт принят — смены разнесены в выплаты');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось принять отчёт');
    }
    reload();
  };

  const removeReport = async () => {
    const ok = await dialog.confirm({
      title: 'Удалить отчёт?',
      message:
        r.status === 'ACCEPTED'
          ? 'Отчёт будет удалён. Уже разнесённые смены и штрафы останутся в «Сменах и выплатах».'
          : 'Отчёт будет удалён безвозвратно.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    // оптимистично: убираем из кэша списка и сразу уходим на список,
    // запрос удаления — в фоне; при ошибке покажем toast (поллинг вернёт отчёт)
    mutateCache<Report[]>('/reports', (prev) =>
      prev.filter((x) => x.id !== r.id),
    );
    toast.success('Отчёт удалён');
    navigate('/reports', { replace: true });
    api.delete(`/reports/${r.id}`).catch((e: any) => {
      toast.error(e?.response?.data?.message || 'Не удалось удалить отчёт');
    });
  };

  return (
    <div className="mx-auto max-w-4xl animate-page-in">
      {/* ── Панель действий (не печатается) ── */}
      {/*
        Панель действий. На телефоне: возврат и удаление по краям верхней
        строки, рабочие кнопки — сеткой ниже, все одного размера. Раньше они
        шли одной лентой и «Удалить» оказывалась под большим пальцем.
      */}
      <div className="no-print mb-4 space-y-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
        <button
          onClick={() => navigate('/reports')}
          className="press inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
        >
          <ArrowLeft className="h-4 w-4" /> К списку
        </button>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {canEdit && (
            <button
              onClick={() => navigate(`/reports/${r.id}/edit`)}
              className="btn-ghost justify-center"
            >
              <Pencil className="h-4 w-4" />
              Редактировать
            </button>
          )}
          {r.status === 'DRAFT' && (
            <button onClick={sendReport} className="btn-primary justify-center">
              <Send className="h-4 w-4" />
              Отправить основателю
            </button>
          )}
          {r.status === 'SENT' && isDirector && (
            <button onClick={acceptReport} className="btn-primary justify-center">
              <CheckCircle2 className="h-4 w-4" />
              Принять
            </button>
          )}
          <button onClick={() => window.print()} className="btn-ghost">
            <Printer className="h-4 w-4" />
            Печать
          </button>
          {/* принятый отчёт может удалить только основатель */}
          {(isDirector || r.status !== 'ACCEPTED') && (
            <button
              onClick={removeReport}
              className="press inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Ведомость (печатается) ── */}
      <div className="print-sheet card p-6 sm:p-8">
        {/* Реквизиты компании на печатной форме акта (ТЗ, п. 4) */}
        <div className="mb-4 hidden border-b border-navy-100 pb-3 text-xs leading-relaxed text-navy-700 print:block">
          <div className="font-semibold">
            {COMPANY.name} · {COMPANY.city}
          </div>
          <div>{companyContacts()}</div>
        </div>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-xl font-extrabold tracking-wide text-navy-900">
            ARCHIDEA <span className="font-medium text-navy-600">· Платёжная ведомость</span>
          </div>
          <Badge className={`no-print ${REPORT_STATUS_COLOR[r.status]}`}>
            {REPORT_STATUS_LABEL[r.status]}
          </Badge>
        </div>
        {r.acceptedAt && (
          <div className="mb-3 text-xs text-green-700">
            ✓ Принят основателем {formatDate(r.acceptedAt)}
          </div>
        )}

        {/* Шапка */}
        <div className="mt-4 overflow-hidden rounded-xl border border-navy-200 text-sm">
          {[
            ['Клиент и контакты', `${r.clientName}${r.clientPhone ? ` · ${r.clientPhone}` : ''}`],
            ['Адрес', r.address || '—'],
            [
              'Дата начала и завершения работ',
              r.workDate
                ? `${formatDate(r.workDate)}${r.workEndDate ? ` — ${formatDate(r.workEndDate)}` : ''}`
                : '—',
            ],
            ['Площадь и стоимость за единицу', r.unitsLabel || '—'],
            ['Доп. услуга и стоимость на единицу', r.extraServices || '—'],
            ['Предоставленная скидка', r.discount ? formatPrice(r.discount) : '—'],
            ['Итоговая стоимость', formatPrice(r.totalPrice)],
            ['Привёл', r.arrivedBy || '—'],
            ['Ответственный бригадир', r.brigadierName || '—'],
            ['Ответственный менеджер', r.managerName || r.manager?.fullName || '—'],
          ].map(([k, v], i) => (
            <div
              key={k}
              className={`flex ${i > 0 ? 'border-t border-navy-100' : ''}`}
            >
              <div className="w-2/5 shrink-0 bg-navy-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-navy-600">
                {k}
              </div>
              <div className={`flex-1 px-3 py-2 text-navy-900 ${k === 'Итоговая стоимость' ? 'font-bold' : ''}`}>
                {v}
              </div>
            </div>
          ))}
        </div>

        {/* Работники */}
        <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-navy-700">
          Работники
        </h3>
        {/* ведомость шире телефона: край растворяется там, куда ещё можно
            тянуть, и гаснет на упоре — колонку «Сумма» видно, что она есть */}
        <ScrollArea axis="x" label="Ведомость работников">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-navy-500 text-left text-xs text-white print:bg-white print:text-navy-900">
                <th className="border border-navy-300 px-2 py-1.5 font-semibold">№</th>
                <th className="border border-navy-300 px-2 py-1.5 font-semibold">ФИО сотрудника</th>
                <th className="border border-navy-300 px-2 py-1.5 font-semibold">Должность</th>
                <th className="border border-navy-300 px-2 py-1.5 text-center font-semibold">Дней/смен</th>
                <th className="border border-navy-300 px-2 py-1.5 text-right font-semibold">Ставка/день</th>
                <th className="border border-navy-300 px-2 py-1.5 text-right font-semibold">Штраф</th>
                <th className="border border-navy-300 px-2 py-1.5 text-right font-semibold">Доп. услуги</th>
                <th className="border border-navy-300 px-2 py-1.5 text-right font-semibold">Сумма</th>
                <th className="hidden border border-navy-300 px-2 py-1.5 font-semibold print:table-cell">Подпись</th>
              </tr>
            </thead>
            <tbody>
              {r.workers.map((w, i) => (
                <tr key={w.id ?? i}>
                  <td className="border border-navy-200 px-2 py-1.5 text-navy-600">{i + 1}</td>
                  <td className="border border-navy-200 px-2 py-1.5 font-medium text-navy-900">{w.fullName}</td>
                  <td className="border border-navy-200 px-2 py-1.5 text-navy-700">{w.role}</td>
                  <td className="border border-navy-200 px-2 py-1.5 text-center text-navy-900">{w.days}</td>
                  <td className="border border-navy-200 px-2 py-1.5 text-right text-navy-900">{w.rate}</td>
                  <td className={`border border-navy-200 px-2 py-1.5 text-right ${w.fine ? 'font-medium text-red-600' : 'text-navy-600'}`}>
                    {w.fine ? `− ${w.fine}` : '—'}
                  </td>
                  <td className="border border-navy-200 px-2 py-1.5 text-right text-navy-900">
                    {w.extra ? `+ ${w.extra}` : '—'}
                  </td>
                  <td className="border border-navy-200 px-2 py-1.5 text-right font-bold text-navy-900">
                    {workerSum(w).toLocaleString('ru-RU')}
                  </td>
                  <td className="hidden border border-navy-200 px-2 py-1.5 print:table-cell" />
                </tr>
              ))}
              <tr className="bg-navy-50 font-bold text-navy-900">
                <td className="border border-navy-200 px-2 py-1.5" colSpan={7}>
                  Итого выплаты работникам
                </td>
                <td className="border border-navy-200 px-2 py-1.5 text-right">
                  {workersSum.toLocaleString('ru-RU')}
                </td>
                <td className="hidden border border-navy-200 print:table-cell" />
              </tr>
            </tbody>
          </table>
        </ScrollArea>

        {/* Доп. расходы */}
        <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-navy-700">
          Доп. расходы
        </h3>
        {r.expenses.length === 0 ? (
          <p className="text-sm text-navy-600">Дополнительных расходов нет</p>
        ) : (
          <ScrollArea axis="x" label="Таблица дополнительных расходов">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-navy-500 text-left text-xs text-white print:bg-white print:text-navy-900">
                  <th className="border border-navy-300 px-2 py-1.5 font-semibold">№</th>
                  <th className="border border-navy-300 px-2 py-1.5 font-semibold">Наименование расхода</th>
                  <th className="border border-navy-300 px-2 py-1.5 font-semibold">Инициатор</th>
                  <th className="border border-navy-300 px-2 py-1.5 text-right font-semibold">Сумма</th>
                  <th className="border border-navy-300 px-2 py-1.5 font-semibold">Комментарий</th>
                  <th className="hidden border border-navy-300 px-2 py-1.5 font-semibold print:table-cell">Подпись</th>
                </tr>
              </thead>
              <tbody>
                {r.expenses.map((e, i) => (
                  <tr key={e.id ?? i}>
                    <td className="border border-navy-200 px-2 py-1.5 text-navy-600">{i + 1}</td>
                    <td className="border border-navy-200 px-2 py-1.5 font-medium text-navy-900">{e.title}</td>
                    <td className="border border-navy-200 px-2 py-1.5 text-navy-700">{e.initiator || '—'}</td>
                    <td className="border border-navy-200 px-2 py-1.5 text-right font-bold text-navy-900">
                      {e.amount.toLocaleString('ru-RU')}
                    </td>
                    <td className="border border-navy-200 px-2 py-1.5 text-navy-700">{e.comment || '—'}</td>
                    <td className="hidden border border-navy-200 px-2 py-1.5 print:table-cell" />
                  </tr>
                ))}
                <tr className="bg-navy-50 font-bold text-navy-900">
                  <td className="border border-navy-200 px-2 py-1.5" colSpan={3}>
                    Итого расходов
                  </td>
                  <td className="border border-navy-200 px-2 py-1.5 text-right">
                    {expensesSum.toLocaleString('ru-RU')}
                  </td>
                  <td className="border border-navy-200" />
                  <td className="hidden border border-navy-200 print:table-cell" />
                </tr>
              </tbody>
            </table>
          </ScrollArea>
        )}

        {/*
          Сводка. Четвёртой цифрой — чистый доход: сколько осталось компании
          после выплат работникам и расходов по объекту. Раньше три числа
          лежали рядом, а вычитать их приходилось в уме.
        */}
        <div className="mt-6 grid gap-3 rounded-xl bg-navy-50 p-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-navy-600">Выручка по объекту</div>
            <div className="text-lg font-extrabold text-navy-900">
              {formatPrice(r.totalPrice)}
            </div>
          </div>
          <div>
            <div className="text-xs text-navy-600">Выплаты работникам</div>
            <div className="text-lg font-extrabold text-navy-900">
              {formatPrice(workersSum)}
            </div>
          </div>
          <div>
            <div className="text-xs text-navy-600">Доп. расходы</div>
            <div className="text-lg font-extrabold text-navy-900">
              {formatPrice(expensesSum)}
            </div>
          </div>
          <div>
            <div className="text-xs text-navy-600">Чистый доход</div>
            <div
              className={`text-lg font-extrabold ${
                netIncome < 0 ? 'text-red-600' : 'text-green-700'
              }`}
            >
              {formatPrice(netIncome)}
            </div>
          </div>
        </div>

        {/* Подписи (для печати) */}
        <div className="mt-8 hidden justify-between gap-8 text-sm print:flex">
          <div>
            Менеджер: подпись ____________________ дата ____________
          </div>
          <div>Бригадир: подпись ____________________</div>
        </div>
        <p className="mt-3 hidden text-xs text-navy-600 print:block">
          Примечание: подпись бригадира подтверждает получение оплаты в полном объёме.
        </p>
      </div>
    </div>
  );
}
