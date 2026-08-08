import { useFetch } from '../api/hooks';
import { formatDateTz } from '../lib/date';

/**
 * Загрузка бригад по дням (ТЗ: планирование).
 *
 * Отвечает на вопрос, который раньше держали в голове: сколько людей уже
 * занято в конкретный день и есть ли кого поставить на новый объект.
 *
 * Раньше день был одной строкой «17 из 17 чел. · 5 выезд(ов)» и слепленными
 * через точку адресами: что за выезды, во сколько и кто едет — не видно.
 * Теперь каждый выезд отдельной строкой, а свободные дни показаны наравне с
 * занятыми: свободный день и есть ответ на «когда взять нового клиента».
 */

interface LoadVisit {
  id: string;
  address: string;
  startTime: string | null;
  endTime: string | null;
  brigadeName: string | null;
  people: number;
  service: string | null;
}

interface LoadDay {
  date: string;
  booked: number;
  visits: number;
  addresses: string[];
  details?: LoadVisit[];
}

/** «1 августа, суббота» — день недели важнее года при планировании */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return formatDateTz(iso);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  });
}

/** «09:00–13:00», «с 14:00» или пусто, если время не проставили */
function timeLabel(v: LoadVisit): string {
  if (v.startTime && v.endTime) return `${v.startTime}–${v.endTime}`;
  if (v.startTime) return `с ${v.startTime}`;
  return 'время не указано';
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
  const days = data.days ?? [];
  const busyDays = days.filter((d) => d.visits > 0).length;

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-navy-700">
          Загрузка бригад
        </h3>
        <span className="text-xs text-navy-600">
          Клинеров в компании: {total} · дней с выездами: {busyDays} из{' '}
          {days.length}
        </span>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-navy-500">За этот период данных нет</p>
      ) : (
        <ul className="space-y-3">
          {days.map((d) => {
            const free = Math.max(0, total - d.booked);
            const share = total > 0 ? Math.min(100, (d.booked / total) * 100) : 0;
            const visits = d.details ?? [];
            return (
              <li key={d.date} className="text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-semibold text-navy-900">
                    {dayLabel(d.date)}
                  </span>
                  <span className="tabular-nums text-xs text-navy-700">
                    {d.visits === 0 ? (
                      <span className="text-emerald-700">
                        выездов нет · свободны все {total}
                      </span>
                    ) : (
                      <>
                        Занято {d.booked} из {total} ·{' '}
                        {free > 0 ? (
                          <span className="text-emerald-700">
                            свободно {free}
                          </span>
                        ) : (
                          <span className="font-semibold text-red-700">
                            свободных нет
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>

                {/* Полоса занятости: видно с одного взгляда, где день забит */}
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-navy-100">
                  <div
                    className={`h-full rounded-full ${
                      share >= 100
                        ? 'bg-red-500'
                        : share >= 70
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{ width: `${d.visits === 0 ? 0 : Math.max(4, share)}%` }}
                  />
                </div>

                {/* Каждый выезд отдельной строкой: время, объект, бригада, состав */}
                {visits.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {visits.map((v) => (
                      <li
                        key={v.id}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-navy-100 bg-navy-50/50 px-2.5 py-1.5"
                      >
                        <span className="shrink-0 font-mono text-xs text-navy-500">
                          {timeLabel(v)}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-navy-900">
                          {v.address || 'адрес не указан'}
                        </span>
                        {v.brigadeName && (
                          <span className="shrink-0 text-xs text-navy-600">
                            {v.brigadeName}
                          </span>
                        )}
                        <span className="shrink-0 text-xs text-navy-600">
                          {v.people} чел.
                        </span>
                        {v.service && (
                          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-navy-600">
                            {v.service}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
