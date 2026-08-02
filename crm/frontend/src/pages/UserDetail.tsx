import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ShieldCheck,
  UserRound,
  Phone,
  Users,
  Loader,
  CheckCircle2,
  UsersRound,
  CheckSquare,
  ChevronRight,
  Pencil,
} from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { TelegramLink } from '../components/TelegramLink';
import {
  Skeleton,
  SkeletonCards,
  SkeletonList,
  PageHeader,
  Badge,
  Modal,
  EmptyState,
  PasswordInput,
  ErrorState,
} from '../components/ui';
import { ScrollArea } from '../components/ScrollArea';
import { useToast } from '../components/Toast';
import { NameInput, PhoneInput } from '../components/ContactFields';
import { formatDate, formatPrice, STAGE_LABEL, STAGE_COLOR } from '../lib/labels';
import { monthRange } from '../lib/date';
import { Period, PeriodFilter, StatCard } from '../components/common';
import { DetailModal, DetailTable } from '../components/Drilldown';
import type { Role } from '../types';

interface UserDetailData {
  id: string;
  login: string;
  fullName: string;
  role: Role;
  phone?: string;
  position?: string | null;
  duties?: string | null;
  mainTask?: string | null;
  canManageOps?: boolean;
  canManageTasks?: boolean;
  canSeeTrash?: boolean;
  noFinance?: boolean;
  isActive: boolean;
  createdAt: string;
  stats: {
    clients: number;
    ordersActive: number;
    ordersPaid: number;
    cleaners: number;
    tasksOpen: number;
  };
}

interface ListItem {
  id: string;
  primary: string;
  secondary: string;
}

export function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user: viewer } = useAuth();
  const { data, loading, error, reload, setData } = useFetch<UserDetailData>(
    `/users/${id}`,
    { deps: [id] },
  );

  // оптимистичное сохранение профиля: карточка обновляется сразу, запрос — в фоне
  const saveUser = (payload: {
    fullName: string;
    login: string;
    phone: string;
    position: string;
    duties: string;
    mainTask: string;
    role: Role;
    canManageOps: boolean;
    canManageTasks: boolean;
    canSeeTrash: boolean;
    noFinance: boolean;
    isActive: boolean;
    password?: string;
  }) => {
    const prev = data; // снапшот для отката, если сеть недоступна
    setData((d) =>
      d
        ? {
            ...d,
            fullName: payload.fullName,
            login: payload.login,
            phone: payload.phone,
            position: payload.position,
            duties: payload.duties,
            mainTask: payload.mainTask,
            role: payload.role,
            canManageOps: payload.canManageOps,
            canManageTasks: payload.canManageTasks,
            canSeeTrash: payload.canSeeTrash,
            noFinance: payload.noFinance,
            isActive: payload.isActive,
          }
        : d,
    );
    api
      .patch(`/users/${id}`, payload)
      .then(() => reload())
      .catch((e: any) => {
        toast.error(e?.response?.data?.message || 'Не удалось сохранить');
        // откат напрямую к снапшоту — корректен даже когда GET недоступен
        setData(prev ?? null);
        reload();
      });
  };
  const [showEdit, setShowEdit] = useState(false);
  const [list, setList] = useState<{ type: string; title: string } | null>(null);
  const { data: items, loading: itemsLoading } = useFetch<ListItem[]>(
    list ? `/users/${id}/list/${list.type}` : null,
    { deps: [list?.type] },
  );

  if (loading)
    return (
      // заглушка повторяет раскладку профиля: шапка-карточка и лента
      // показателей — при появлении данных страница не перестраивается
      <div className="animate-page-in">
        <Skeleton className="mb-5 h-48 w-full rounded-md" />
        <SkeletonCards
          count={5}
          className="!gap-4 sm:!grid-cols-3 lg:!grid-cols-5"
        />
      </div>
    );
  if (error || !data) {
    return (
      <div className="animate-page-in">
        <button
          onClick={() => navigate(-1)}
          className="press mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 shadow-card">
          {error || 'Профиль не найден'}
        </div>
      </div>
    );
  }

  const isDirector = data.role === 'DIRECTOR';
  const stats = [
    { type: 'clients', label: 'Клиентов', value: data.stats.clients, icon: Users, color: 'bg-navy-100 text-navy-700' },
    { type: 'active', label: 'Активные заказы', value: data.stats.ordersActive, icon: Loader, color: 'bg-indigo-100 text-indigo-700' },
    { type: 'paid', label: 'Завершено', value: data.stats.ordersPaid, icon: CheckCircle2, color: 'bg-green-100 text-green-700' },
    { type: 'cleaners', label: 'Клинеров', value: data.stats.cleaners, icon: UsersRound, color: 'bg-amber-100 text-amber-700' },
    { type: 'tasks', label: 'Открытых задач', value: data.stats.tasksOpen, icon: CheckSquare, color: 'bg-blue-100 text-blue-700' },
  ];

  return (
    <div className="animate-page-in">
      <button
        onClick={() => navigate(-1)}
        className="press mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
      >
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>

      <PageHeader title="Профиль сотрудника" />

      {/* Подключение бота — только в своём профиле: «Старт» за другого не нажать */}
      {viewer?.id === data.id && <TelegramLink />}

      <div className="card mb-5 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold ${
              isDirector ? 'bg-brand-500 text-white' : 'bg-navy-100 text-navy-700'
            }`}
          >
            {isDirector ? (
              <ShieldCheck className="h-8 w-8" />
            ) : (
              <UserRound className="h-8 w-8" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold text-navy-900">
              {data.fullName}
            </div>
            <div className="text-sm text-navy-600">
              @{data.login}
              {data.position && (
                <span className="text-navy-600"> · {data.position}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                className={
                  isDirector
                    ? 'bg-navy-100 text-navy-700'
                    : 'bg-blue-100 text-blue-700'
                }
              >
                {isDirector ? 'Руководитель' : 'Менеджер'}
              </Badge>
              <Badge
                className={
                  data.isActive
                    ? 'bg-green-100 text-green-700'
                    : 'bg-navy-100 text-navy-600'
                }
              >
                {data.isActive ? '● Активен' : '○ Отключён'}
              </Badge>
            </div>
          </div>
          {viewer?.role === 'DIRECTOR' && (
            <button
              onClick={() => setShowEdit(true)}
              className="press inline-flex items-center gap-1.5 self-start rounded-xl border border-navy-200 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              <Pencil className="h-4 w-4" />
              Редактировать
            </button>
          )}
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-3 border-t border-navy-100 pt-5 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between">
            <dt className="text-navy-600">Телефон</dt>
            <dd className="flex items-center gap-1.5 font-medium text-navy-800">
              <Phone className="h-4 w-4 text-navy-600" />
              {data.phone || '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-navy-600">В системе с</dt>
            <dd className="font-medium text-navy-800">
              {formatDate(data.createdAt)}
            </dd>
          </div>
        </dl>

        {(data.duties || data.mainTask) && (
          <div className="mt-5 border-t border-navy-100 pt-5">
            {data.duties && (
              <>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-600">
                  Отвечает за
                </div>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {data.duties
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((d) => (
                      <li
                        key={d}
                        className="flex items-start gap-2 text-sm text-navy-800"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" />
                        {d}
                      </li>
                    ))}
                </ul>
              </>
            )}
            {data.mainTask && (
              <div className="mt-4 rounded-xl bg-navy-50 p-3.5">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-600">
                  Основная задача
                </div>
                <div className="text-sm font-medium text-navy-900">
                  {data.mainTask}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <button
            key={s.type}
            onClick={() => setList({ type: s.type, title: s.label })}
            className="card-interactive press p-5 text-left"
          >
            <div className="flex items-center justify-between">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.color}`}
              >
                <s.icon className="h-5 w-5" />
              </span>
              <ChevronRight className="h-4 w-4 text-navy-600" />
            </div>
            <div className="mt-3 text-2xl font-extrabold text-navy-900">
              {s.value}
            </div>
            <div className="text-sm text-navy-600">{s.label}</div>
          </button>
        ))}
      </div>

      <PeriodAnalytics userId={id!} fullName={data.fullName} />

      <Modal
        open={!!list}
        onClose={() => setList(null)}
        title={list ? `${list.title} — ${data.fullName}` : ''}
      >
        {itemsLoading ? (
          <SkeletonList rows={4} />
        ) : !items || items.length === 0 ? (
          <EmptyState text="Пусто" />
        ) : (
          // список длиннее окна: край растворяется с той стороны, куда ещё
          // есть куда крутить, — видно, что записи продолжаются, без подписи
          <ScrollArea
            axis="y"
            innerClassName="max-h-[60vh] space-y-2"
            label={list?.title}
          >
            {items.map((it) => {
              const clickable = list?.type === 'clients';
              return (
                <div
                  key={it.id}
                  onClick={
                    clickable
                      ? () => {
                          setList(null);
                          navigate(`/clients/${it.id}`);
                        }
                      : undefined
                  }
                  className={`flex items-center justify-between rounded-xl border border-navy-100 px-4 py-3 ${
                    clickable ? 'press cursor-pointer hover:bg-navy-50' : ''
                  }`}
                >
                  <span className="font-medium text-navy-900">{it.primary}</span>
                  <span className="text-sm text-navy-600">{it.secondary}</span>
                </div>
              );
            })}
          </ScrollArea>
        )}
      </Modal>

      {showEdit && (
        <EditUserModal
          user={data}
          onClose={() => setShowEdit(false)}
          onSubmit={saveUser}
        />
      )}
    </div>
  );
}

function EditUserModal({
  user,
  onClose,
  onSubmit,
}: {
  user: UserDetailData;
  onClose: () => void;
  onSubmit: (payload: {
    fullName: string;
    login: string;
    phone: string;
    position: string;
    duties: string;
    mainTask: string;
    role: Role;
    canManageOps: boolean;
    canManageTasks: boolean;
    canSeeTrash: boolean;
    noFinance: boolean;
    isActive: boolean;
    password?: string;
  }) => void;
}) {
  const toast = useToast();
  const [fullName, setFullName] = useState(user.fullName);
  const [login, setLogin] = useState(user.login);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [position, setPosition] = useState(user.position ?? '');
  const [duties, setDuties] = useState(user.duties ?? '');
  const [mainTask, setMainTask] = useState(user.mainTask ?? '');
  const [role, setRole] = useState<Role>(user.role);
  const [canManageOps, setCanManageOps] = useState(!!user.canManageOps);
  // ТЗ 1.2 — личный доступ к модулю задач (у Ироды)
  const [canManageTasks, setCanManageTasks] = useState(!!user.canManageTasks);
  const [canSeeTrash, setCanSeeTrash] = useState(!!user.canSeeTrash);
  const [noFinance, setNoFinance] = useState(!!user.noFinance);
  const [isActive, setIsActive] = useState(user.isActive);
  const [password, setPassword] = useState('');

  // оптимистично: применяем и закрываем сразу, запрос уходит в фон
  const submit = () => {
    onSubmit({
      fullName,
      login,
      phone,
      position,
      duties,
      mainTask,
      role,
      canManageOps,
      canManageTasks,
      canSeeTrash,
      // запрет на финансы имеет смысл только у руководителя: у менеджера
      // денег и так нет, и хранить у него взведённый флаг незачем
      noFinance: role === 'DIRECTOR' ? noFinance : false,
      isActive,
      ...(password ? { password } : {}),
    });
    toast.success('Сохранено');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Редактирование сотрудника">
      <div className="space-y-3">
        <NameInput value={fullName} onChange={setFullName} />
        <div>
          <label className="label">Логин</label>
          <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} />
        </div>
        <PhoneInput value={phone} onChange={setPhone} />
        <div>
          <label className="label">Должность</label>
          <input
            className="input"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="Например: Операционный управляющий"
          />
        </div>
        <div>
          <label className="label">Обязанности (по одной на строку)</label>
          <textarea
            className="input min-h-[110px] resize-none"
            value={duties}
            onChange={(e) => setDuties(e.target.value)}
            placeholder={'Контроль качества\nРабота с клиентами'}
          />
        </div>
        <div>
          <label className="label">Основная задача</label>
          <input
            className="input"
            value={mainTask}
            onChange={(e) => setMainTask(e.target.value)}
            placeholder="Главная цель сотрудника"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Роль</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="MANAGER">Менеджер</option>
              <option value="DIRECTOR">Руководитель</option>
            </select>
          </div>
          <div>
            <label className="label">Статус</label>
            <select
              className="input"
              value={isActive ? '1' : '0'}
              onChange={(e) => setIsActive(e.target.value === '1')}
            >
              <option value="1">Активен</option>
              <option value="0">Отключён</option>
            </select>
          </div>
        </div>

        {/* Общая база — только для менеджеров (руководитель и так видит всё).
            Разделы менеджеру открыты и без этого флага; он расширяет именно
            ОБЛАСТЬ ДАННЫХ: свои клиенты и заказы → вся компания. */}
        {role === 'MANAGER' && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={canManageOps}
              onChange={(e) => setCanManageOps(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-navy-500"
            />
            <span className="text-sm text-navy-800">
              <span className="font-medium">Видит базу всей компании</span>
              <span className="mt-0.5 block text-xs text-navy-600">
                Без флага сотрудник работает во всех разделах, но видит только
                своих клиентов и свои заказы. С флагом — чужие тоже, плюс задачи
                всей компании. Доходы, расходы и выплаты остаются закрыты.
              </span>
            </span>
          </label>
        )}

        {/* Полный доступ к задачам — отдельно от расширенного доступа:
            нужен сотруднику, который ведёт задачи всей компании, но
            во всём остальном остаётся обычным менеджером (ТЗ 1.2) */}
        {role === 'MANAGER' && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={canManageTasks}
              onChange={(e) => setCanManageTasks(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-navy-500"
            />
            <span className="text-sm text-navy-800">
              <span className="font-medium">Полный доступ к задачам</span>
              <span className="mt-0.5 block text-xs text-navy-600">
                Видит, ставит, назначает и контролирует задачи всей компании,
                включая календарь. На доступ к клиентам, заказам и финансам
                не влияет.
              </span>
            </span>
          </label>
        )}

        {/* Корзина — только руководителю и только с этим флагом: руководителей
            несколько, а разбирать удалённое доверено конкретным людям.
            Менеджерам раздел закрыт целиком, поэтому им флаг не показываем. */}
        {role === 'DIRECTOR' && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={canSeeTrash}
              onChange={(e) => setCanSeeTrash(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-navy-500"
            />
            <span className="text-sm text-navy-800">
              <span className="font-medium">Доступ к корзине</span>
              <span className="mt-0.5 block text-xs text-navy-600">
                Видит удалённые записи, возвращает их и очищает безвозвратно.
                Раздел доступен только руководителям.
              </span>
            </span>
          </label>
        )}

        {/* Персональный запрет на финансы — сильнее роли. Показываем только
            руководителю: у менеджера денег и так нет, галочка ничего не
            изменит и только запутает. */}
        {role === 'DIRECTOR' && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
            <input
              type="checkbox"
              checked={noFinance}
              onChange={(e) => setNoFinance(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-600"
            />
            <span className="text-sm text-navy-800">
              <span className="font-medium">Без доступа к финансам</span>
              <span className="mt-0.5 block text-xs text-navy-600">
                Сохраняет управление людьми, услугами и операциями, но не видит
                доходов и расходов, выплат, премий и выручки — ни в меню, ни по
                прямой ссылке. Активные сессии сотрудника при этом сбрасываются.
              </span>
            </span>
          </label>
        )}

        <div>
          <label className="label">Новый пароль (необязательно)</label>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="оставьте пустым, чтобы не менять"
          />
          <p className="mt-1 text-xs text-navy-600">
            Минимум 8 символов. После смены сотрудник будет разлогинен на всех
            устройствах — старые сессии перестанут действовать.
          </p>
          {password.length > 0 && password.length < 8 && (
            <p className="mt-1 text-xs font-medium text-red-600">
              Пароль слишком короткий: минимум 8 символов
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={
              !fullName || !login || (password.length > 0 && password.length < 8)
            }
            className="btn-primary"
          >
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}


/** Ответ /users/:id/analytics — показатели сотрудника за период */
interface UserPeriodAnalytics {
  total: number;
  paid: number;
  rejected: number;
  conversion: number;
  revenue: number;
  average: number;
  discounts: number;
  tasksDone: number;
  remindersDone: number;
  orders: {
    id: string;
    stage: string;
    createdAt: string;
    price: number;
    client: { id: string; fullName: string; phone: string } | null;
  }[];
}

/**
 * Работа сотрудника за период — основа для расчёта зарплаты.
 *
 * Считается по когорте: заказы, ПРИНЯТЫЕ в периоде, и сколько из них дошло
 * до оплаты — личная конверсия без смешения чужих месяцев. Задачи и
 * напоминания — для ролей, где продажи не главное (логист, маркетолог).
 */
function PeriodAnalytics({
  userId,
  fullName,
}: {
  userId: string;
  fullName: string;
}) {
  const [period, setPeriod] = useState<Period>(() => monthRange());
  const [showOrders, setShowOrders] = useState(false);

  const query = new URLSearchParams();
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);

  const { data, loading, error, reload } = useFetch<UserPeriodAnalytics>(
    `/users/${userId}/analytics?${query.toString()}`,
    { deps: [userId, period.from, period.to] },
  );

  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-600">
          Работа за период
        </h3>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error ? (
        <ErrorState text={error ?? undefined} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonCards count={4} className="!gap-4" />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Принял обращений"
              value={data.total}
              title="Все заказы сотрудника за период"
              onClick={() => setShowOrders(true)}
            />
            <StatCard
              label="Оплачено"
              value={data.paid}
              tone="positive"
              hint={`конверсия ${data.conversion}%`}
              title="Оплаченные из принятых за период"
              onClick={() => setShowOrders(true)}
            />
            <StatCard
              label="Выручка"
              value={formatPrice(data.revenue)}
              tone="positive"
              hint={data.paid ? `средний чек ${formatPrice(data.average)}` : undefined}
              title="Сумма оплаченных заказов сотрудника"
              onClick={() => setShowOrders(true)}
            />
            <StatCard
              label="Задачи и напоминания"
              value={`${data.tasksDone} · ${data.remindersDone}`}
              hint="выполнено задач · отработано напоминаний"
            />
          </div>

          {showOrders && (
            <DetailModal
              title={`Заказы за период — ${fullName}`}
              subtitle={
                period.from && period.to
                  ? `${formatDate(period.from)} — ${formatDate(period.to)}`
                  : 'за всё время'
              }
              onClose={() => setShowOrders(false)}
            >
              <DetailTable
                rows={data.orders}
                rowKey={(o: UserPeriodAnalytics['orders'][number]) => o.id}
                emptyText="Заказов за период нет"
                columns={[
                  {
                    key: 'client',
                    header: 'Клиент',
                    cell: (o: UserPeriodAnalytics['orders'][number]) => (
                      <div>
                        <div className="font-medium text-navy-900">
                          {o.client?.fullName ?? '—'}
                        </div>
                        <div className="text-xs text-navy-600">
                          {o.client?.phone ?? ''}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'stage',
                    header: 'Этап',
                    cell: (o: UserPeriodAnalytics['orders'][number]) => (
                      <Badge
                        className={
                          STAGE_COLOR[o.stage as keyof typeof STAGE_COLOR] ??
                          'bg-navy-100 text-navy-600'
                        }
                      >
                        {STAGE_LABEL[o.stage as keyof typeof STAGE_LABEL] ?? o.stage}
                      </Badge>
                    ),
                  },
                  {
                    key: 'date',
                    header: 'Принят',
                    cell: (o: UserPeriodAnalytics['orders'][number]) => (
                      <span className="text-navy-600">{formatDate(o.createdAt)}</span>
                    ),
                  },
                  {
                    key: 'price',
                    header: 'Сумма',
                    align: 'right',
                    cell: (o: UserPeriodAnalytics['orders'][number]) => formatPrice(o.price),
                  },
                ]}
                footer={
                  data.orders.length > 0 ? (
                    <tr className="border-t border-navy-100 font-bold text-navy-900">
                      <td className="px-3 py-2" colSpan={3}>
                        Итого оплачено
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-700">
                        {formatPrice(data.revenue)}
                      </td>
                    </tr>
                  ) : undefined
                }
              />
            </DetailModal>
          )}
        </>
      ) : null}
    </div>
  );
}
