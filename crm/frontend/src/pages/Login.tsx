import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // обрезаем случайные пробелы по краям (частая причина «неверный пароль»)
      await login(loginValue.trim(), password.trim());
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-gradient p-4">
      <div className="w-full max-w-sm animate-page-in">
        <div className="mb-8 text-center text-white">
          <img
            src="/logo-white.png"
            alt="Archidea Cleaning"
            className="mx-auto mb-3 h-28 w-auto"
          />
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/90">
            CRM-система
          </p>
        </div>

        <form onSubmit={submit} className="card p-6">
          <div className="mb-4">
            <label className="label">Логин</label>
            <input
              className="input"
              value={loginValue}
              onChange={(e) => setLoginValue(e.target.value)}
              placeholder="Введите логин"
              autoFocus
            />
          </div>
          <div className="mb-4">
            <label className="label">Пароль</label>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
            />
          </div>
          {/*
            Галочки «Запомнить меня» больше нет: вход и так держится 90 дней
            и продлевается при каждом открытии CRM (решение владельца).
            Оставлять переключатель, который ничего не меняет, — обманывать.
          */}
          <p className="mb-5 text-xs text-navy-600">
            Пароль вводится один раз — вход на этом устройстве сохраняется
            навсегда. На чужом компьютере выходите кнопкой «Выйти».
          </p>

          {error && (
            // сообщение об ошибке проявляется, а не возникает рывком:
            // иначе непонятно, ответил сервер или страница дёрнулась сама
            <div className="mb-4 animate-fade-in rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            <LogIn className="h-4 w-4" />
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
