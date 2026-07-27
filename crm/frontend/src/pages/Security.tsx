import { useFetch } from '../api/hooks';
import { Spinner, PageHeader, Badge, EmptyState } from '../components/ui';
import { ShieldCheck, ShieldAlert, Lock, Monitor } from 'lucide-react';

interface Attempt {
  id: string;
  login: string;
  userId?: string | null;
  success: boolean;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

interface LockedUser {
  id: string;
  login: string;
  fullName: string;
  lockedUntil: string;
}

interface AttemptsData {
  items: Attempt[];
  failed24h: number;
  locked: LockedUser[];
}

const REASON_LABEL: Record<string, string> = {
  BAD_PASSWORD: 'Неверный пароль',
  NO_USER: 'Такого логина нет',
  LOCKED: 'Аккаунт заблокирован',
  INACTIVE: 'Сотрудник отключён',
};

/** Короткое описание устройства из User-Agent */
function device(ua?: string | null): string {
  if (!ua) return '—';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone/iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS/i.test(ua)) return 'Mac';
  if (/curl|python|node/i.test(ua)) return '⚠️ скрипт';
  return 'другое';
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Security() {
  const { data, loading } = useFetch<AttemptsData>('/auth/login-attempts?limit=200', {
    pollMs: 30000,
  });

  if (loading || !data) return <Spinner />;

  const failed = data.items.filter((a) => !a.success);

  return (
    <div>
      <PageHeader
        title="Безопасность"
        subtitle="Кто и когда входил в систему, попытки подбора пароля"
      />

      {/* Сводка */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-100 text-navy-700">
              <Monitor className="h-5 w-5" />
            </span>
            <div>
              <div className="text-2xl font-extrabold text-navy-900">
                {data.items.filter((a) => a.success).length}
              </div>
              <div className="text-sm text-navy-500">Успешных входов</div>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                data.failed24h > 20
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <div className="text-2xl font-extrabold text-navy-900">
                {data.failed24h}
              </div>
              <div className="text-sm text-navy-500">Неудачных за сутки</div>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                data.locked.length > 0
                  ? 'bg-red-100 text-red-700'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              {data.locked.length > 0 ? (
                <Lock className="h-5 w-5" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )}
            </span>
            <div>
              <div className="text-2xl font-extrabold text-navy-900">
                {data.locked.length}
              </div>
              <div className="text-sm text-navy-500">Заблокировано сейчас</div>
            </div>
          </div>
        </div>
      </div>

      {/* Заблокированные аккаунты */}
      {data.locked.length > 0 && (
        <div className="card mb-6 border-red-200 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-600">
            <Lock className="h-4 w-4" />
            Заблокированы после серии неудачных попыток
          </h3>
          <div className="space-y-2">
            {data.locked.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50/50 px-3.5 py-2.5"
              >
                <span className="font-medium text-navy-900">
                  {u.fullName}{' '}
                  <span className="text-sm text-navy-400">@{u.login}</span>
                </span>
                <span className="text-sm text-red-600">
                  до {when(u.lockedUntil)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-navy-400">
            Блокировка снимается автоматически. Если это ваш сотрудник — он
            просто ошибся паролем. Если логин чужой и попыток много — кто-то
            подбирает пароль.
          </p>
        </div>
      )}

      {/* Журнал */}
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-400">
        Последние попытки входа
      </h3>
      {data.items.length === 0 ? (
        <EmptyState text="Записей пока нет" />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-400">
                <th className="px-4 py-3 font-semibold">Когда</th>
                <th className="px-4 py-3 font-semibold">Логин</th>
                <th className="px-4 py-3 font-semibold">Результат</th>
                <th className="px-4 py-3 font-semibold">Адрес</th>
                <th className="px-4 py-3 font-semibold">Устройство</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr
                  key={a.id}
                  className={`border-b border-navy-50 ${
                    a.success ? '' : 'bg-red-50/30'
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-navy-500">
                    {when(a.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-navy-900">
                    {a.login}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.success ? (
                      <Badge className="bg-green-100 text-green-700">Вход</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700">
                        {REASON_LABEL[a.reason ?? ''] ?? 'Отказано'}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-navy-500">{a.ip || '—'}</td>
                  <td className="px-4 py-2.5 text-navy-500">
                    {device(a.userAgent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {failed.length > 0 && (
        <p className="mt-3 text-xs text-navy-400">
          Много отказов с одного адреса подряд — признак подбора пароля. После 5
          неудач подряд аккаунт закрывается на 15 минут автоматически.
        </p>
      )}
    </div>
  );
}
