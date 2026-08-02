import { useState } from 'react';
import { useFetch } from '../api/hooks';

/**
 * Выбор тегов клиента кнопками.
 *
 * Справочник тегов никто не ведёт руками: варианты — это все теги, которые
 * уже есть у клиентов (эндпоинт /clients/labels). Новый тег заводится
 * кнопкой «+ свой» и сразу становится вариантом для всех, потому что
 * попадает в тот же список.
 */
export function LabelPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { data: known } = useFetch<string[]>('/clients/labels');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // варианты = общий список плюс теги этого клиента (вдруг их ещё нет в базе)
  const options = [...new Set([...(known ?? []), ...value])].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

  const toggle = (tag: string) =>
    onChange(
      value.includes(tag) ? value.filter((x) => x !== tag) : [...value, tag],
    );

  const commit = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => toggle(tag)}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
            value.includes(tag)
              ? 'bg-navy-100 text-navy-800 ring-2 ring-navy-300'
              : 'border border-navy-200 bg-white text-navy-600 hover:bg-navy-50'
          }`}
        >
          {tag}
        </button>
      ))}

      {adding ? (
        <input
          autoFocus
          className="input input-xs w-32"
          value={draft}
          maxLength={40}
          placeholder="новый тег"
          onChange={(e) => setDraft(e.target.value)}
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
          onBlur={commit}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-lg border border-dashed border-navy-300 px-2.5 py-1 text-xs font-semibold text-brand-600 hover:bg-navy-50"
        >
          + свой
        </button>
      )}

      {options.length === 0 && !adding && (
        <span className="text-xs text-navy-600">
          тегов пока нет — заведите первый
        </span>
      )}
    </div>
  );
}
