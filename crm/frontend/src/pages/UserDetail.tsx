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
import {
  Spinner,
  PageHeader,
  Badge,
  Modal,
  EmptyState,
  PasswordInput,
} from '../components/ui';
import { useToast } from '../components/Toast';
import { NameInput, PhoneInput } from '../components/ContactFields';
import { formatDate } from '../lib/labels';
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

  if (loading) return <Spinner />;
  if (error || !data) {
    return (
      <div>
        <button
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-800"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
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
    <div>
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-800"
      >
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>

      <PageHeader title="Профиль сотрудника" />

      <div className="card mb-5 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold ${
              isDirector ? 'bg-navy-500 text-white' : 'bg-navy-100 text-navy-700'
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
            <div className="text-sm text-navy-400">
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
                    : 'bg-navy-100 text-navy-500'
                }
              >
                {data.isActive ? '● Активен' : '○ Отключён'}
              </Badge>
            </div>
          </div>
          {viewer?.role === 'DIRECTOR' && (
            <button
              onClick={() => setShowEdit(true)}
              className="inline-flex items-center gap-1.5 self-start rounded-xl border border-navy-200 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              <Pencil className="h-4 w-4" />
              Редактировать
            </button>
          )}
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-3 border-t border-navy-100 pt-5 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between">
            <dt className="text-navy-400">Телефон</dt>
            <dd className="flex items-center gap-1.5 font-medium text-navy-800">
              <Phone className="h-4 w-4 text-navy-400" />
              {data.phone || '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-navy-400">В системе с</dt>
            <dd className="font-medium text-navy-800">
              {formatDate(data.createdAt)}
            </dd>
          </div>
        </dl>

        {(data.duties || data.mainTask) && (
          <div className="mt-5 border-t border-navy-100 pt-5">
            {data.duties && (
              <>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-400">
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
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-navy-400" />
                        {d}
                      </li>
                    ))}
                </ul>
              </>
            )}
            {data.mainTask && (
              <div className="mt-4 rounded-xl bg-navy-50 p-3.5">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-500">
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
            className="card p-5 text-left transition-shadow hover:shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.color}`}
              >
                <s.icon className="h-5 w-5" />
              </span>
              <ChevronRight className="h-4 w-4 text-navy-300" />
            </div>
            <div className="mt-3 text-2xl font-extrabold text-navy-900">
              {s.value}
            </div>
            <div className="text-sm text-navy-500">{s.label}</div>
          </button>
        ))}
      </div>

      <Modal
        open={!!list}
        onClose={() => setList(null)}
        title={list ? `${list.title} — ${data.fullName}` : ''}
      >
        {itemsLoading ? (
          <Spinner />
        ) : !items || items.length === 0 ? (
          <EmptyState text="Пусто" />
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
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
                    clickable ? 'cursor-pointer hover:bg-navy-50' : ''
                  }`}
                >
                  <span className="font-medium text-navy-900">{it.primary}</span>
                  <span className="text-sm text-navy-400">{it.secondary}</span>
                </div>
              );
            })}
          </div>
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

        {/* Расширенный доступ — только для менеджеров (директор и так видит всё) */}
        {role === 'MANAGER' && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-navy-100 bg-navy-50/50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={canManageOps}
              onChange={(e) => setCanManageOps(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-navy-500"
            />
            <span className="text-sm text-navy-800">
              <span className="font-medium">Расширенный доступ (без финансов)</span>
              <span className="mt-0.5 block text-xs text-navy-500">
                Видит клиентов, заказы, команду и аналитику всей компании, ставит
                задачи любому сотруднику. Без разделов «Смены и выплаты», «Отчёты»,
                «Тарифы» и без данных о доходах.
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
              <span className="mt-0.5 block text-xs text-navy-500">
                Видит, ставит, назначает и контролирует задачи всей компании,
                включая календарь. На доступ к клиентам, заказам и финансам
                не влияет.
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
          <p className="mt-1 text-xs text-navy-400">
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
