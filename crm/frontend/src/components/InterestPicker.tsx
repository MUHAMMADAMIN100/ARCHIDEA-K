import { useState } from 'react';
import { useFetch } from '../api/hooks';

/**
 * Степень заинтересованности клиента — один вариант из списка.
 *
 * Справочника-раздела нет намеренно: варианты — это три предустановленных
 * («Перезвоню», «Подумаю», «Посоветуюсь») плюс всё, что менеджеры вписали
 * сами кнопкой «+ свой». Новый вариант сразу становится общим для компании,
 * потому что попадает в тот же список (/clients/interest-levels). Так же
 * устроены теги клиента.
 *
 * Повторный выбор снимает отметку: состояние клиента меняется, и «ничего из
 * перечисленного» — тоже ответ.
 */
export function InterestPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { data: known } = useFetch<string[]>('/clients/interest-levels');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // выбранное значение показываем всегда, даже если его ещё нет в справочнике
  const options = [...new Set([...(known ?? []), ...(value ? [value] : [])])];

  const commit = () => {
    const v = draft.trim().slice(0, 40);
    setDraft('');
    setAdding(false);
    if (v) onChange(v);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? null : o)}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
            value === o
              ? 'border border-brand-400 bg-brand-50 text-brand-800 ring-2 ring-brand-100'
              : 'border border-navy-200 bg-white text-navy-600 hover:bg-navy-50'
          }`}
        >
          {o}
        </button>
      ))}

      {adding ? (
        <input
          autoFocus
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder="свой вариант"
          className="input-sm w-36"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-lg border border-dashed border-navy-300 px-2.5 py-1 text-xs font-semibold text-navy-600 transition hover:bg-navy-50"
        >
          + свой
        </button>
      )}
    </div>
  );
}
