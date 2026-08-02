import { useMemo, useState } from 'react';
import { useFetch } from '../api/hooks';
import { formatPhone } from '../lib/contact';
import type { Client } from '../types';

/**
 * Выбор клиента с поиском по имени и телефону.
 *
 * Нужен там, где дело привязано к конкретному человеку: встреча, звонок,
 * выезд. Список клиентов небольшой, поэтому фильтруем на месте — без
 * запроса на каждую букву.
 */
export function ClientPicker({
  value,
  onChange,
  placeholder = 'Без клиента',
}: {
  value: string | null;
  onChange: (id: string | null, client: Client | null) => void;
  placeholder?: string;
}) {
  const { data } = useFetch<Client[]>('/clients?sort=recent');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const chosen = (data ?? []).find((c) => c.id === value) ?? null;

  const found = useMemo(() => {
    const list = data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 30);
    const digits = q.replace(/\D/g, '');
    return list
      .filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          (digits && c.phone.includes(digits)),
      )
      .slice(0, 30);
  }, [data, query]);

  if (chosen && !open) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-navy-900">
            {chosen.fullName}
          </span>
          <span className="block truncate text-xs text-navy-600">
            {formatPhone(chosen.phone)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setOpen(true);
          }}
          className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
        >
          Изменить
        </button>
        <button
          type="button"
          onClick={() => onChange(null, null)}
          className="shrink-0 text-xs font-medium text-navy-600 hover:underline"
        >
          Убрать
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        className="input"
        value={query}
        autoFocus={open}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="mt-1 max-h-52 overflow-y-auto overscroll-contain rounded-xl border border-navy-100 bg-white py-1 shadow-card">
          {found.length === 0 ? (
            <div className="px-3 py-3 text-sm text-navy-600">
              Клиенты не найдены
            </div>
          ) : (
            found.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id, c);
                  setOpen(false);
                  setQuery('');
                }}
                className="block w-full px-3 py-2 text-left hover:bg-navy-50"
              >
                <span className="block truncate text-sm font-medium text-navy-900">
                  {c.fullName}
                </span>
                <span className="block truncate text-xs text-navy-600">
                  {formatPhone(c.phone)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
