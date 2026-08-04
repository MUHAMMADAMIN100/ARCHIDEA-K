import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../api/client';
import { Modal } from './ui';
import { useToast } from './Toast';
import { DatePicker } from './DatePicker';
import { formatPrice } from '../lib/labels';
import type { Proposal, ProposalItem } from '../types';

/**
 * Правка коммерческого предложения (ТЗ 9).
 *
 * Сервер умел править КП с самого начала, а из интерфейса это было
 * невозможно: менеджер, ошибшийся в цифре, заводил КП заново — с новым
 * номером и потерянной историей. Здесь правятся ровно те поля, из которых
 * складывается предложение: смета, скидка, адрес и срок действия. Текст
 * пересобирается сервером по шаблону.
 */

interface Draft {
  key: string;
  title: string;
  section: string;
  unit: string;
  volume: string;
  unitPrice: string;
}

/** Разделы, которые предлагаются в подсказке — свой можно вписать любой */
const SECTIONS = ['Работы', 'Дополнительные услуги', 'Материалы'];

function toDraft(item: ProposalItem, i: number): Draft {
  return {
    key: `${i}`,
    title: item.title,
    section: item.section ?? '',
    unit: item.unit ?? '',
    volume: item.volume != null ? String(item.volume) : '',
    unitPrice: item.unitPrice != null ? String(item.unitPrice) : '',
  };
}

function amountOf(d: Draft): number {
  const volume = Number(d.volume) || 0;
  const price = Math.round(Number(d.unitPrice) || 0);
  return Math.max(0, Math.round(volume * price));
}

export function ProposalEditModal({
  proposal,
  onClose,
  onSaved,
}: {
  proposal: Proposal;
  onClose: () => void;
  onSaved: (updated: Proposal) => void;
}) {
  const toast = useToast();

  const [address, setAddress] = useState(proposal.address ?? '');
  const [discount, setDiscount] = useState(
    proposal.discount ? String(proposal.discount) : '',
  );
  const [validUntil, setValidUntil] = useState(
    proposal.validUntil ? proposal.validUntil.slice(0, 10) : '',
  );
  const [items, setItems] = useState<Draft[]>(
    (proposal.items ?? []).map(toDraft),
  );
  const [manualTotal, setManualTotal] = useState(false);
  const [total, setTotal] = useState(String(proposal.total));
  const [saving, setSaving] = useState(false);

  const gross = items.reduce((sum, d) => sum + amountOf(d), 0);
  const discountN = Math.max(0, Math.round(Number(discount) || 0));
  const autoTotal = Math.max(0, gross - discountN);
  const effectiveTotal = manualTotal
    ? Math.max(0, Math.round(Number(total) || 0))
    : autoTotal;

  const patch = (i: number, part: Partial<Draft>) =>
    setItems((prev) => prev.map((d, j) => (j === i ? { ...d, ...part } : d)));

  const save = async () => {
    const rows = items
      .filter((d) => d.title.trim())
      .map((d) => ({
        title: d.title.trim(),
        section: d.section.trim() || undefined,
        unit: d.unit.trim() || undefined,
        volume: d.volume ? Number(d.volume) : undefined,
        unitPrice: d.unitPrice ? Math.round(Number(d.unitPrice)) : undefined,
        amount: amountOf(d) || undefined,
      }));

    setSaving(true);
    try {
      const { data } = await api.patch<Proposal>(`/proposals/${proposal.id}`, {
        address: address.trim(),
        discount: discountN,
        items: rows,
        ...(manualTotal ? { total: effectiveTotal } : {}),
        ...(validUntil ? { validUntil } : {}),
      });
      toast.success('КП обновлено');
      onSaved(data);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить КП');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Правка КП №${proposal.number}`} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Адрес объекта</label>
            <input
              className="input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={300}
              placeholder="Душанбе, …"
            />
          </div>
          <div>
            <label className="label">Действует до</label>
            <DatePicker value={validUntil} onChange={setValidUntil} />
          </div>
        </div>

        {/* Смета: разделы и позиции */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Смета</span>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-xs"
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  {
                    key: `${Date.now()}-${prev.length}`,
                    title: '',
                    section: prev[prev.length - 1]?.section ?? SECTIONS[0],
                    unit: '',
                    volume: '',
                    unitPrice: '',
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Добавить позицию
            </button>
          </div>

          {items.length === 0 && (
            <p className="text-sm text-navy-500">
              Позиций нет — предложение уйдёт одной суммой
            </p>
          )}

          <div className="space-y-2">
            {items.map((d, i) => (
              <div
                key={d.key}
                className="rounded-xl border border-navy-100 bg-navy-50/50 p-2"
              >
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[10rem] flex-[2]">
                    <label className="label">Наименование</label>
                    <input
                      className="input-sm w-full"
                      value={d.title}
                      onChange={(e) => patch(i, { title: e.target.value })}
                      maxLength={200}
                      placeholder="Например: Генеральная уборка"
                    />
                  </div>
                  <div className="min-w-[8rem] flex-1">
                    <label className="label">Раздел</label>
                    <input
                      className="input-sm w-full"
                      list="proposal-sections"
                      value={d.section}
                      onChange={(e) => patch(i, { section: e.target.value })}
                      maxLength={80}
                      placeholder="Работы"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Убрать позицию"
                    className="mb-1 rounded-lg p-1 text-navy-400 hover:bg-white hover:text-red-600"
                    onClick={() =>
                      setItems((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-24">
                    <label className="label">Объём</label>
                    <input
                      type="number"
                      min={0}
                      className="input-sm w-full"
                      value={d.volume}
                      onChange={(e) => patch(i, { volume: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="w-20">
                    <label className="label">Ед.</label>
                    <input
                      className="input-sm w-full"
                      value={d.unit}
                      onChange={(e) => patch(i, { unit: e.target.value })}
                      maxLength={20}
                      placeholder="м²"
                    />
                  </div>
                  <div className="w-28">
                    <label className="label">Цена за ед.</label>
                    <input
                      type="number"
                      min={0}
                      className="input-sm w-full"
                      value={d.unitPrice}
                      onChange={(e) => patch(i, { unitPrice: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="mb-1 ml-auto text-sm font-semibold tabular-nums text-navy-900">
                    {formatPrice(amountOf(d))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <datalist id="proposal-sections">
            {SECTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Скидка, сомони</label>
            <input
              type="number"
              min={0}
              className="input"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0"
            />
            <label className="mt-3 flex items-center gap-2 text-sm text-navy-700">
              <input
                type="checkbox"
                checked={manualTotal}
                onChange={(e) => {
                  setManualTotal(e.target.checked);
                  if (e.target.checked) setTotal(String(autoTotal));
                }}
              />
              Задать итог вручную
            </label>
            {manualTotal && (
              <input
                type="number"
                min={0}
                className="input mt-2"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            )}
          </div>
          <div className="rounded-xl bg-navy-50 px-3 py-2 text-sm">
            <div className="flex justify-between text-navy-600">
              <span>Сумма позиций</span>
              <span className="tabular-nums">{formatPrice(gross)}</span>
            </div>
            {discountN > 0 && (
              <div className="flex justify-between font-medium text-red-700">
                <span>Скидка</span>
                <span className="tabular-nums">− {formatPrice(discountN)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-navy-200 pt-1 font-bold text-navy-900">
              <span>Итого клиенту</span>
              <span className="tabular-nums">{formatPrice(effectiveTotal)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button className="btn-ghost flex-1 justify-center" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-primary flex-1 justify-center"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
