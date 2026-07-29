import { Link } from 'react-router-dom';
import {
  Inbox,
  Loader,
  CheckCircle2,
  Users,
  Wallet,
  ArrowRight,
} from 'lucide-react';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Spinner, PageHeader, ErrorState } from '../components/ui';
import { formatPrice, formatVolume } from '../lib/labels';
import { formatPhone } from '../lib/contact';
import type { Order, Task } from '../types';

interface Summary {
  newLeads: number;
  inProgress: number;
  doneThisMonth: number;
  totalClients: number;
  revenueMonth?: number;
}

export function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch<Summary>(
    '/analytics/summary',
    { pollMs: 15000 },
  );
  const { data: orders } = useFetch<Order[]>('/orders?stage=NEW', {
    pollMs: 15000,
  });
  const { data: tasks } = useFetch<Task[]>('/tasks', { pollMs: 20000 });

  // нет данных: показываем ошибку с повтором (а не вечный спиннер),
  // если запрос завершился ошибкой; иначе — спиннер загрузки
  if (!data) {
    if (error && !loading) return <ErrorState onRetry={reload} />;
    return <Spinner />;
  }

  const cards = [
    { label: 'Новые заявки', value: data.newLeads, icon: Inbox, color: 'bg-navy-100 text-navy-700', to: '/funnel' },
    { label: 'Заказы в работе', value: data.inProgress, icon: Loader, color: 'bg-indigo-100 text-indigo-700', to: '/funnel' },
    { label: 'Выполнено за месяц', value: data.doneThisMonth, icon: CheckCircle2, color: 'bg-green-100 text-green-700', to: '/funnel' },
    { label: 'Клиентов в базе', value: data.totalClients, icon: Users, color: 'bg-amber-100 text-amber-700', to: '/clients' },
  ];

  const openTasks = (tasks ?? []).filter((t) => t.status !== 'DONE').slice(0, 5);

  return (
    <div>
      <PageHeader
        title={`Здравствуйте, ${user?.fullName?.split(' ')[0]}!`}
        subtitle="Сводка по работе на сегодня"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="card p-5 transition-shadow hover:shadow-lg">
            <div className="flex items-center justify-between">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </span>
              <ArrowRight className="h-4 w-4 text-navy-300" />
            </div>
            <div className="mt-4 text-3xl font-extrabold text-navy-900">
              {c.value}
            </div>
            <div className="text-sm text-navy-500">{c.label}</div>
          </Link>
        ))}
      </div>

      {/* Доход — приходит только руководителю (финансы) */}
      {data.revenueMonth !== undefined && (
        <div className="mt-4 card flex items-center justify-between border-0 bg-navy-gradient p-6 text-white">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
              <Wallet className="h-6 w-6 text-white" />
            </span>
            <div>
              <div className="text-sm text-white/90">Доход за текущий месяц</div>
              <div className="text-3xl font-extrabold">
                {formatPrice(data.revenueMonth)}
              </div>
            </div>
          </div>
          <Link to="/analytics" className="btn bg-white/10 text-white hover:bg-white/20">
            Подробная аналитика
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Новые заявки */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-navy-900">Новые заявки</h2>
            <Link to="/funnel" className="text-sm font-medium text-navy-500 hover:text-navy-800">
              Все →
            </Link>
          </div>
          <div className="space-y-2">
            {(orders ?? []).slice(0, 5).map((o) => (
              <Link
                key={o.id}
                to={`/clients/${o.clientId}`}
                className="flex items-center justify-between rounded-xl border border-navy-100 px-3 py-2.5 hover:bg-navy-50"
              >
                <div>
                  <div className="text-sm font-semibold text-navy-800">
                    {o.client?.fullName}
                  </div>
                  <div className="text-xs text-navy-400">
                    {formatVolume(o)} · {formatPhone(o.client?.phone)}
                  </div>
                </div>
                <div className="text-sm font-bold text-navy-700">
                  {formatPrice(o.estimatedPrice)}
                </div>
              </Link>
            ))}
            {(!orders || orders.length === 0) && (
              <div className="py-6 text-center text-sm text-navy-400">
                Новых заявок нет
              </div>
            )}
          </div>
        </div>

        {/* Мои задачи */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-navy-900">Актуальные задачи</h2>
            <Link to="/tasks" className="text-sm font-medium text-navy-500 hover:text-navy-800">
              Все →
            </Link>
          </div>
          <div className="space-y-2">
            {openTasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-navy-100 px-3 py-2.5"
              >
                <div className="text-sm font-medium text-navy-800">{t.title}</div>
                <span className="text-xs text-navy-400">
                  {t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : ''}
                </span>
              </div>
            ))}
            {openTasks.length === 0 && (
              <div className="py-6 text-center text-sm text-navy-400">
                Открытых задач нет
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
