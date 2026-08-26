import { forwardRef, Fragment } from 'react';
import { COMPANY } from '../lib/company';
import { formatDateTz } from '../lib/date';
import { formatPrice } from '../lib/labels';
import type { Proposal } from '../types';

/*
 * Коммерческое предложение — лист A4 в фирменном стиле (решение владельца):
 * синяя шапка с логотипом, таблица реквизитов, текст предложения целиком,
 * таблица услуг с составом и подпись руководителя. Один и тот же блок
 * уходит и в PDF (печать), и в картинку для мессенджера, поэтому всё
 * оформление — здесь, а не в CSS печати.
 */

const num = (v: number) => v.toLocaleString('ru-RU');

/** Строки таблицы реквизитов */
function headerRows(p: Proposal): [string, string][] {
  const volume = p.area != null ? `${p.area} м²` : '—';
  const rows: [string, string][] = [
    ['Клиент', `${p.clientName}${p.clientPhone ? ` · ${p.clientPhone}` : ''}`],
    ['Адрес объекта', p.address || '—'],
    ['Объём и цена', p.pricePerSqm != null ? `${volume} × ${formatPrice(p.pricePerSqm)}` : volume],
  ];
  if (p.discount) rows.push(['Скидка', formatPrice(p.discount)]);
  rows.push(['Итоговая сумма', formatPrice(p.total)]);
  rows.push(['Действует до', p.validUntil ? formatDateTz(p.validUntil) : '—']);
  rows.push(['Подготовил', p.createdByName]);
  return rows;
}

export const OfferReceipt = forwardRef<HTMLDivElement, { p: Proposal }>(function OfferReceipt(
  { p },
  ref,
) {
  const items = p.items ?? [];
  return (
    <div
      ref={ref}
      className="offer-receipt w-full max-w-3xl overflow-hidden rounded-2xl bg-white text-navy-900 shadow-card"
      style={{ fontFamily: 'Inter, "Segoe UI", Roboto, system-ui, sans-serif' }}
    >
      {/* фирменная шапка */}
      <div className="bg-brand-500 px-8 py-6 text-white" data-testid="чек-шапка">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img src="/logo-white.png" alt="Archidea Cleaning" className="h-16 w-auto shrink-0" />
            <div>
              <div className="text-xl font-extrabold uppercase leading-tight tracking-wide">
                Archidea Cleaning
              </div>
              <div className="mt-0.5 text-xs text-white/85">
                Профессиональный клининг · {COMPANY.city} · работаем {COMPANY.workingHours}
              </div>
            </div>
          </div>
          <div className="text-right text-xs leading-relaxed text-white/95">
            <div className="font-semibold">{COMPANY.phones.join(' · ')}</div>
            <div>{COMPANY.email}</div>
            <div>
              Instagram {COMPANY.instagram} · Telegram {COMPANY.telegram}
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        {/* заголовок документа */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-brand-500 pb-3">
          <div className="text-xl font-bold">Коммерческое предложение №{p.number}</div>
          <div className="text-sm text-navy-600">от {formatDateTz(p.createdAt)}</div>
        </div>

        {/* реквизиты */}
        <div className="mt-5 overflow-hidden rounded-xl border border-brand-100 text-sm" data-testid="чек-реквизиты">
          {headerRows(p).map(([k, v], i) => (
            <div key={k} className={`flex ${i > 0 ? 'border-t border-brand-100' : ''}`}>
              <div className="w-2/5 shrink-0 bg-brand-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
                {k}
              </div>
              <div className={`flex-1 px-3 py-2 ${k === 'Итоговая сумма' ? 'font-bold text-brand-700' : ''}`}>
                {v}
              </div>
            </div>
          ))}
        </div>

        {/* текст предложения — целиком, как был */}
        {p.bodySnapshot && (
          <div className="mt-6" data-testid="чек-текст">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-700">
              Текст предложения
            </h3>
            <p className="whitespace-pre-wrap rounded-xl border border-brand-100 bg-brand-50/40 p-4 text-sm leading-relaxed">
              {p.bodySnapshot}
            </p>
          </div>
        )}

        {/* услуги */}
        {items.length > 0 && (
          <table className="mt-6 w-full border-collapse text-sm" data-testid="чек-таблица">
            <thead>
              <tr className="bg-brand-500 text-left text-xs text-white">
                <th className="w-8 px-2 py-2 font-semibold">№</th>
                <th className="px-2 py-2 font-semibold">Список предоставляемых услуг</th>
                <th className="w-28 px-2 py-2 text-right font-semibold">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <Fragment key={i}>
                  {it.section && it.section !== items[i - 1]?.section && (
                    <tr className="bg-brand-50">
                      <td className="border-x border-b border-brand-100 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-700" colSpan={3}>
                        {it.section}
                      </td>
                    </tr>
                  )}
                  <tr className="align-top" data-testid="чек-строка">
                    <td className="border-x border-b border-brand-100 px-2 py-2 text-navy-600">{i + 1}</td>
                    <td className="border-b border-brand-100 px-2 py-2">
                      <div className="font-semibold">{it.title}</div>
                      <ul className="mt-1 space-y-0.5 text-xs text-navy-700">
                        {it.volume != null && (
                          <li>• Объём: {num(it.volume)}{it.unit ? ` ${it.unit}` : ''}</li>
                        )}
                        {it.unitPrice != null && (
                          <li>• Стоимость услуги — {formatPrice(it.unitPrice)}{it.unit ? `/${it.unit}` : ''}</li>
                        )}
                      </ul>
                      {it.includes && it.includes.length > 0 && (
                        <div className="mt-2">
                          <div className="text-xs font-semibold">В состав услуги входит:</div>
                          <ul className="mt-0.5 space-y-0.5 text-xs text-navy-700">
                            {it.includes.map((w, k) => (
                              <li key={k}>• {w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {it.note && <div className="mt-2 text-xs text-navy-600">{it.note}</div>}
                    </td>
                    <td className="border-x border-b border-brand-100 px-2 py-2 text-right font-bold tabular-nums">
                      {it.amount != null ? (
                        <>
                          <span className="block whitespace-nowrap">{num(it.amount)}</span>
                          <span className="block text-xs font-normal text-navy-600">сомони</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                </Fragment>
              ))}
              {p.discount > 0 && (
                <tr data-testid="чек-скидка">
                  <td className="border-x border-b border-brand-100 px-2 py-1.5" colSpan={2}>
                    Скидка
                  </td>
                  <td className="whitespace-nowrap border-x border-b border-brand-100 px-2 py-1.5 text-right font-semibold tabular-nums text-emerald-700">
                    −{num(p.discount)}
                  </td>
                </tr>
              )}
              <tr className="bg-brand-50 font-bold" data-testid="чек-итого">
                <td className="rounded-bl-xl border-x border-b border-brand-100 px-2 py-3 text-brand-700" colSpan={2}>
                  Стоимость комплексного клининга помещения
                </td>
                <td className="whitespace-nowrap border-x border-b border-brand-100 px-2 py-3 text-right text-lg tabular-nums text-brand-700">
                  {num(p.total)}
                  <span className="block text-xs font-normal text-navy-600">сомони</span>
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {/* подпись */}
        <div className="mt-8 flex items-end justify-between gap-8 text-sm" data-testid="чек-подпись">
          <div>
            <div className="text-navy-700">С уважением и надеждой на долгосрочное сотрудничество</div>
            <div className="mt-3 font-medium text-navy-700">{COMPANY.directorTitle}</div>
            <div className="font-bold">{COMPANY.director}</div>
          </div>
          <div className="text-right text-xs text-navy-600">
            <div>Подготовил: {p.createdByName}</div>
            <div className="mt-3">Подпись ____________________ дата ____________</div>
          </div>
        </div>
      </div>

      <div className="border-t border-brand-100 bg-brand-50 px-8 py-2.5 text-center text-[11px] text-navy-600">
        {COMPANY.name} · {COMPANY.city} · {COMPANY.phones.join(' · ')} · {COMPANY.email}
      </div>
    </div>
  );
});
