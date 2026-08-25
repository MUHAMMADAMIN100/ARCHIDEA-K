import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox,
  Loader,
  CheckCircle2,
  Users,
  Wallet,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Skeleton, PageHeader, ErrorState } from '../components/ui';
import { OrdersDrilldownModal } from '../components/OrdersDrilldown';
import { TaskModal } from '../components/TaskModal';
import { formatDate, formatPrice, formatVolume } from '../lib/labels';
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
  const {
    data: tasks,
    setData: setTasks,
    reload: reloadTasks,
  } = useFetch<Task[]>('/tasks', { pollMs: 20000 });
  /*
   * Задача открывается прямо здесь, а не уводит в раздел «Задачи».
   * Раньше нажатие меняло страницу: человек терял сводку и возвращался
   * назад руками — ради одного взгляда на задачу.
   */
  const [editTask, setEditTask] = useState<Task | null>(null);
  const taskFlight = useRef(0);
  const [drill, setDrill] = useState<{
    title: string;
    subtitle?: string;
    metric: string;
    key?: string;
  } | null>(null);

  // нет данных: показываем ошибку с повтором (а не вечный спиннер),
  // если запрос завершился ошибкой; иначе — заглушку загрузки
  if (!data) {
    if (error && !loading) return <ErrorState text={error ?? undefined} onRetry={reload} />;
    /*
     * Заглушка повторяет раскладку дашборда: заголовок, четыре плитки с
     * цифрами и два списка под ними. Место под данные занято заранее,
     * поэтому в момент их появления экран не прыгает.
     */
    return (
      <div className="animate-page-in" role="status" aria-label="Загрузка">
        <div className="mb-5">
          <Skeleton className="h-8 w-64 max-w-full rounded-md" />
          <Skeleton className="mt-1 h-5 w-44 max-w-full rounded-md" />
        </div>
        {/* заглушка повторяет сетку плиток один в один — экран не прыгнет */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-md sm:h-40" />
          ))}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-md" />
          <Skeleton className="h-96 rounded-md" />
        </div>
      </div>
    );
  }

  /*
   * Цифра на карточке — вход в работу, а не итог.
   *
   * Раньше клик открывал список окном: посмотреть можно, а сделать ничего
   * нельзя — окно приходилось закрывать и идти в воронку руками. Теперь
   * карточка ведёт прямо в воронку и прокручивает её к нужному этапу.
   * «Выполнено за месяц» остаётся расшифровкой: это отчётная цифра за
   * период, в доске «сейчас» её не покажешь.
   */
  const cards = [
    {
      label: 'Новые заявки',
      value: data.newLeads,
      icon: Inbox,
      color: 'bg-navy-100 text-navy-700',
      to: '/funnel?stage=NEW',
    },
    {
      label: 'Заказы в работе',
      value: data.inProgress,
      icon: Loader,
      color: 'bg-indigo-100 text-indigo-700',
      to: '/funnel?stage=IN_PROGRESS',
    },
    {
      label: 'Выполнено за месяц',
      value: data.doneThisMonth,
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-700',
      drill: {
        title: 'Выполнено за месяц',
        subtitle: 'Заказы, оплаченные в текущем месяце',
        metric: 'paidThisMonth',
      },
    },
    {
      label: 'Клиентов в базе',
      value: data.totalClients,
      icon: Users,
      color: 'bg-amber-100 text-amber-700',
      to: '/clients',
    },
  ];

  const openTasks = (tasks ?? []).filter((t) => t.status !== 'DONE').slice(0, 5);

  return (
    <div className="animate-page-in">
      <PageHeader
        title={`Здравствуйте, ${user?.fullName?.split(' ')[0]}!`}
        subtitle="Сводка по работе на сегодня"
      />

      {/*
        На телефоне плитки идут по две в ряд и компактнее: по одной в ряд
        сводка занимала четыре экрана, и «Клиентов в базе» нельзя было увидеть
        не пролистав. От sm и шире всё остаётся ровно как было — правка
        касается только мобильной вёрстки.
      */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {cards.map((c) => {
          const body = (
            <>
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl sm:h-11 sm:w-11 ${c.color}`}
                >
                  <c.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-navy-600 sm:h-4 sm:w-4" />
              </div>
              <div className="mt-2.5 text-2xl font-extrabold leading-none text-navy-900 sm:mt-4 sm:text-3xl">
                {c.value}
              </div>
              <div className="mt-1 text-xs leading-tight text-navy-600 sm:mt-0 sm:text-sm">
                {c.label}
              </div>
            </>
          );

          return c.to ? (
            <Link
              key={c.label}
              to={c.to}
              className="card-interactive press p-3.5 sm:p-5"
            >
              {body}
            </Link>
          ) : (
            <button
              key={c.label}
              type="button"
              onClick={() => setDrill(c.drill!)}
              title="Показать эти заказы"
              className="card-interactive press p-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-300 sm:p-5"
            >
              {body}
            </button>
          );
        })}
      </div>

      {/*
        Доход — приходит только руководителю (финансы).
        Единственная тёмная плашка на экране: это главная цифра дня.
      */}
      {data.revenueMonth !== undefined && (
        <div className="mt-4 card flex flex-col items-start gap-4 border-ink-900 bg-ink-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white/10">
              <Wallet className="h-6 w-6 text-white" />
            </span>
            <div>
              <div className="text-sm text-white/90">Доход за текущий месяц</div>
              <button
                type="button"
                onClick={() =>
                  setDrill({
                    title: 'Доход за текущий месяц',
                    subtitle: 'Заказы, оплаченные в этом месяце',
                    metric: 'paidThisMonth',
                  })
                }
                title="Из каких заказов сложился доход"
                className="press text-2xl font-extrabold underline decoration-dotted underline-offset-4 decoration-white/50 transition hover:decoration-white sm:text-3xl"
              >
                {formatPrice(data.revenueMonth)}
              </button>
            </div>
          </div>
          <Link
            to="/finance"
            className="btn w-full justify-center bg-white/10 text-white hover:bg-white/20 sm:w-auto"
          >
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
            <Link to="/funnel" className="text-sm font-medium text-navy-600 hover:text-navy-800">
              Все →
            </Link>
          </div>
          <div className="space-y-2">
            {(orders ?? []).slice(0, 5).map((o) => (
              <Link
                key={o.id}
                to={`/clients/${o.clientId}`}
                className="press flex items-center justify-between rounded-xl border border-navy-100 px-3 py-2.5 hover:bg-navy-50"
              >
                <div>
                  <div className="text-sm font-semibold text-navy-800">
                    {o.client?.fullName}
                  </div>
                  {/*
                    Дата обращения — по ней видно, сколько заявка ждёт ответа.
                    Раньше в строке были только объём и телефон: вчерашняя
                    заявка ничем не отличалась от недельной.
                  */}
                  <div className="text-xs text-navy-600">
                    {formatDate(o.createdAt)} · {formatVolume(o)} ·{' '}
                    {formatPhone(o.client?.phone)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-navy-700">
                  {formatPrice(o.estimatedPrice)}
                  <ChevronRight className="h-4 w-4 text-navy-400" />
                </div>
              </Link>
            ))}
            {(!orders || orders.length === 0) && (
              <div className="py-6 text-center text-sm text-navy-600">
                Новых заявок нет
              </div>
            )}
          </div>
        </div>

        {/* Мои задачи */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-navy-900">Актуальные задачи</h2>
            <Link to="/tasks" className="text-sm font-medium text-navy-600 hover:text-navy-800">
              Все →
            </Link>
          </div>
          <div className="space-y-2">
            {/*
              Строка задачи открывает саму задачу — раздел «Задачи» покажет
              её карточку по адресу. Раньше это был неподвижный текст: увидеть
              задачу на дашборде было можно, а открыть — нет, приходилось
              искать её заново в списке.
            */}
            {openTasks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setEditTask(t)}
                className="press flex w-full items-center justify-between gap-3 rounded-xl border border-navy-100 px-3 py-2.5 text-left hover:bg-navy-50"
              >
                <div className="min-w-0 truncate text-sm font-medium text-navy-800">
                  {t.title}
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-navy-600">
                  {t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : ''}
                  <ChevronRight className="h-4 w-4 text-navy-400" />
                </span>
              </button>
            ))}
            {openTasks.length === 0 && (
              <div className="py-6 text-center text-sm text-navy-600">
                Открытых задач нет
              </div>
            )}
          </div>
        </div>
      </div>

      {editTask && (
        <TaskModal
          key={editTask.id}
          mode="edit"
          task={(tasks ?? []).find((t) => t.id === editTask.id) ?? editTask}
          onClose={() => setEditTask(null)}
          onCreate={() => {}}
          onPatch={(id, patch) =>
            setTasks((list) =>
              list ? list.map((t) => (t.id === id ? { ...t, ...patch } : t)) : list,
            )
          }
          onDeleted={(id) =>
            setTasks((list) => (list ? list.filter((t) => t.id !== id) : list))
          }
          onReload={reloadTasks}
          inFlightRef={taskFlight}
        />
      )}

      {drill && (
        <OrdersDrilldownModal
          title={drill.title}
          subtitle={drill.subtitle}
          metric={drill.metric}
          drillKey={drill.key}
          showMoney={user?.role === 'DIRECTOR'}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}
