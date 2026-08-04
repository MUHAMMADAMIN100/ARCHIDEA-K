import { useFetch } from '../api/hooks';
import { formatDateTz } from '../lib/date';

/**
 * Загрузка бригад по дням (ТЗ: планирование).
 *
 * Отвечает на вопрос, который раньше держали в голове: сколько людей уже
 * занято в конкретный день и есть ли кого поставить на новый объект.
 * Считается по выездам — у каждого есть день и состав.
 */

interface LoadDay {
  date: string;
  booked: number;
  visits: number;
  addresses: string[];
}

export function BrigadeLoad({ from, to }: { from: string; to: string }) {
  const { data, loading } = useFetch<{ total: number; days: LoadDay[] }>(
    `/brigade-load?from=${from}&to=${to}`,
    { deps: [from, to] },
  );

  if (loading && !data) {
    return (
      <div className="card p-4 text-sm text-navy-500">Считаем загрузку…</div>
    );
  }
  if (!data) return null;

  const total = data.total || 0;
  const busy = data.days.filter((d) => d.visits > 0);

  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-navy-700">
          Загрузка бригад
        </h3>
        <span className="text-xs text-navy-600">
          Всего клинеров в компании: {total}
        </span>
      </div>

      {busy.length === 0 ? (
        <p className="text-sm text-navy-500">
          На эти дни выездов не запланировано — люди свободны
        </p>
      ) : (
        <ul className="space-y-1.5">
          {busy.map((d) => {
            const share = total > 0 ? Math.min(100, (d.booked / total) * 100) : 0;
            return (
              <li key={d.date} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap font-medium text-navy-900">
                    {formatDateTz(d.date)}
                  </span>
                  <span className="tabular-nums text-navy-700">
                    {d.booked} из {total} чел. · {d.visits} выезд(ов)
                  </span>
                </div>
                {/* Полоса занятости: видно с одного взгляда, где день забит */}
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
                  <div
                    className={`h-full rounded-full ${
                      share >= 90
                        ? 'bg-red-500'
                        : share >= 60
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.max(4, share)}%` }}
                  />
                </div>
                {d.addresses.length > 0 && (
                  <div className="mt-0.5 truncate text-xs text-navy-500">
                    {d.addresses.join(' · ')}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
