import { forwardRef, Fragment } from 'react';
import { COMPANY } from '../lib/company';
import { formatDateTz } from '../lib/date';
import type { Proposal } from '../types';

/*
 * Коммерческое предложение в виде чека (решение владельца): узкая колонка,
 * фирменная синяя шапка с логотипом, работы построчно, крупный ИТОГО,
 * срок действия и менеджер. Ничего лишнего — ни условий, ни подписей:
 * клиент должен прочитать его с телефона за десять секунд.
 *
 * Один и тот же блок уходит и в PDF (печать), и в картинку для мессенджера,
 * поэтому всё оформление — здесь, а не в CSS печати.
 */

const num = (v: number) => v.toLocaleString('ru-RU');

export const OfferReceipt = forwardRef<HTMLDivElement, { p: Proposal }>(function OfferReceipt(
  { p },
  ref,
) {
  const items = p.items ?? [];
  const validUntil = p.validUntil ? formatDateTz(p.validUntil) : null;
  return (
    <div
      ref={ref}
      className="offer-receipt w-[400px] max-w-full overflow-hidden rounded-2xl bg-white text-navy-900 shadow-card"
      style={{ fontFamily: 'Inter, "Segoe UI", Roboto, system-ui, sans-serif' }}
    >
      {/* фирменная шапка */}
      <div className="bg-brand-500 px-6 pb-5 pt-6 text-white" data-testid="чек-шапка">
        <div className="flex items-center gap-4">
          <img src="/logo-white.png" alt="Archidea Cleaning" className="h-16 w-auto shrink-0" />
          <div className="min-w-0">
            <div className="text-lg font-extrabold uppercase leading-tight tracking-wide">
              Archidea Cleaning
            </div>
            <div className="mt-0.5 text-xs text-white/85">
              Профессиональный клининг · {COMPANY.city}
            </div>
            <div className="mt-1.5 text-xs font-medium text-white/95">
              {COMPANY.phones.join(' · ')}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-base font-bold">Коммерческое предложение</div>
          <div className="whitespace-nowrap text-xs text-navy-600">
            № {p.number} · {formatDateTz(p.createdAt)}
          </div>
        </div>

        {/* клиент */}
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-navy-600">Клиент</dt>
            <dd className="font-semibold">{p.clientName}</dd>
          </div>
          {p.clientPhone && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-navy-600">Телефон</dt>
              <dd>{p.clientPhone}</dd>
            </div>
          )}
          {p.address && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-navy-600">Объект</dt>
              <dd>{p.address}</dd>
            </div>
          )}
        </dl>

        {/* работы */}
        <div className="mt-4 border-t border-dashed border-navy-200 pt-3">
          {items.length === 0 ? (
            <div className="py-2 text-sm text-navy-600">
              {p.area != null ? `Уборка ${p.area} м²` : 'Комплексная уборка'}
            </div>
          ) : (
            items.map((it, i) => (
              <Fragment key={i}>
                {it.section && it.section !== items[i - 1]?.section && (
                  <div className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wider text-brand-600">
                    {it.section}
                  </div>
                )}
                <div className="flex items-start justify-between gap-3 py-1.5" data-testid="чек-строка">
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-snug">{it.title}</div>
                    {(it.volume != null || it.unitPrice != null) && (
                      <div className="text-xs text-navy-600">
                        {it.volume != null ? `${num(it.volume)}${it.unit ? ` ${it.unit}` : ''}` : ''}
                        {it.volume != null && it.unitPrice != null ? ' × ' : ''}
                        {it.unitPrice != null ? `${num(it.unitPrice)} сомони` : ''}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums">
                    {it.amount != null ? num(it.amount) : '—'}
                  </div>
                </div>
              </Fragment>
            ))
          )}
        </div>

        {/* скидка — только если есть */}
        {p.discount > 0 && (
          <div
            className="mt-2 flex items-center justify-between border-t border-dashed border-navy-200 pt-2 text-sm text-emerald-700"
            data-testid="чек-скидка"
          >
            <span>Скидка</span>
            <span className="font-semibold tabular-nums">−{num(p.discount)}</span>
          </div>
        )}

        {/* итог */}
        <div className="mt-3 flex items-end justify-between rounded-xl bg-brand-50 px-4 py-3" data-testid="чек-итого">
          <span className="text-sm font-bold uppercase tracking-wide text-brand-700">Итого</span>
          <span className="text-2xl font-extrabold tabular-nums text-brand-700">
            {num(p.total)} <span className="text-sm font-semibold">сомони</span>
          </span>
        </div>

        {/* срок и менеджер */}
        <div className="mt-4 space-y-1 text-xs text-navy-600">
          {validUntil && (
            <div>
              Предложение действительно до <span className="font-semibold text-navy-900">{validUntil}</span>
            </div>
          )}
          <div>
            Ваш менеджер: <span className="font-semibold text-navy-900">{p.createdByName}</span>
          </div>
        </div>
      </div>

      {/* подвал с контактами */}
      <div className="mt-5 border-t border-navy-100 bg-navy-50 px-6 py-3 text-center text-[11px] leading-relaxed text-navy-600">
        <div>
          Instagram {COMPANY.instagram} · Telegram {COMPANY.telegram}
        </div>
        <div>
          {COMPANY.email} · работаем {COMPANY.workingHours}
        </div>
      </div>
    </div>
  );
});
