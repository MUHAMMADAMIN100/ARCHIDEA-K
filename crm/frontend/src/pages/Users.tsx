import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ShieldCheck, UserRound, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { Spinner, PageHeader, Badge, Modal, PasswordInput } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { useAuth } from '../auth/AuthContext';
import { tempId, withRetry } from '../lib/util';
import type { Manager, Role } from '../types';

export function UsersPage() {
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, reload, setData } = useFetch<Manager[]>('/users');
  const [showAdd, setShowAdd] = useState(false);

  const removeUser = async (u: Manager) => {
    const ok = await dialog.confirm({
      title: 'Удалить сотрудника?',
      message: `${u.fullName} (@${u.login}) будет удалён. Его клиенты и заказы останутся, но без назначенного менеджера.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setData((list) => (list ? list.filter((x) => x.id !== u.id) : list));
    try {
      await withRetry(() => api.delete(`/users/${u.id}`));
      toast.success('Сотрудник удалён');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось удалить сотрудника');
      reload();
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    setData((u) =>
      u ? u.map((x) => (x.id === id ? { ...x, isActive } : x)) : u,
    );
    try {
      await api.patch(`/users/${id}/active`, { isActive });
    } catch {
      toast.error('Не удалось изменить статус сотрудника');
      reload();
    }
  };

  // оптимистично: сотрудник появляется сразу
  const createUser = (payload: {
    fullName: string;
    login: string;
    password: string;
    role: Role;
  }) => {
    const id = tempId();
    const optimistic: Manager = {
      id,
      login: payload.login,
      fullName: payload.fullName,
      role: payload.role,
      isActive: true,
    };
    setData((u) => (u ? [...u, optimistic] : [optimistic]));
    api
      .post('/users', payload)
      .then(() => reload())
      .catch((e) => {
        toast.error(e?.response?.data?.message || 'Не удалось создать сотрудника');
        setData((u) => (u ? u.filter((x) => x.id !== id) : u));
      });
  };

  return (
    <div>
      <PageHeader
        title="Сотрудники"
        subtitle="Руководители и менеджеры системы"
        action={
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="h-4 w-4" />
            Добавить сотрудника
          </button>
        }
      />

      {loading || !data ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((u) => (
            <div
              key={u.id}
              onClick={() => navigate(`/profile/${u.id}`)}
              className="card cursor-pointer p-5 transition-shadow hover:shadow-lg"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                    u.role === 'DIRECTOR'
                      ? 'bg-navy-500 text-white'
                      : 'bg-navy-100 text-navy-700'
                  }`}
                >
                  {u.role === 'DIRECTOR' ? (
                    <ShieldCheck className="h-5 w-5" />
                  ) : (
                    <UserRound className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-navy-900">{u.fullName}</div>
                  <div className="text-xs text-navy-600">@{u.login}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Badge
                  className={
                    u.role === 'DIRECTOR'
                      ? 'bg-navy-100 text-navy-700'
                      : 'bg-blue-100 text-blue-700'
                  }
                >
                  {u.role === 'DIRECTOR' ? 'Руководитель' : 'Менеджер'}
                </Badge>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleActive(u.id, !u.isActive);
                    }}
                    className={`text-xs font-semibold ${
                      u.isActive ? 'text-green-600' : 'text-navy-600'
                    }`}
                  >
                    {u.isActive ? '● Активен' : '○ Отключён'}
                  </button>
                  {u.id !== user?.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeUser(u);
                      }}
                      className="rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                      title="Удалить сотрудника"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onCreate={createUser}
        />
      )}
    </div>
  );
}

function AddUserModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (payload: {
    fullName: string;
    login: string;
    password: string;
    role: Role;
  }) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('MANAGER');

  const submit = () => {
    onCreate({ fullName, login, password, role });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Новый сотрудник">
      <div className="space-y-3">
        <div>
          <label className="label">ФИО *</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="label">Логин *</label>
          <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="например, manager3" />
        </div>
        <div>
          <label className="label">Пароль * (мин. 8 символов)</label>
          <PasswordInput value={password} onChange={setPassword} placeholder="••••••••" />
        </div>
        <div>
          <label className="label">Роль</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="MANAGER">Менеджер</option>
            <option value="DIRECTOR">Руководитель</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">Отмена</button>
          <button
            onClick={submit}
            disabled={!fullName || !login || password.length < 8}
            className="btn-primary"
          >
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}
