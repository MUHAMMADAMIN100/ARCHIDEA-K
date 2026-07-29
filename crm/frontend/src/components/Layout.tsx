import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { prefetch } from '../api/hooks';
import {
  LayoutDashboard,
  Filter,
  Users,
  CheckSquare,
  CalendarDays,
  CalendarRange,
  UsersRound,
  Wallet,
  FileText,
  BarChart3,
  Tags,
  UserCog,
  ShieldCheck,
  LogOut,
  ShieldOff,
  Menu,
  X,
  UserCircle,
  ChevronDown,
  Trash2,
  Coins,
  History,
  ListChecks,
  FileSignature,
  BellRing,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { NotificationsBell } from './NotificationsBell';
import { userManagesTasks, userSeesAll } from '../types';
import type { Role } from '../types';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: Role[]; // если не указано — доступно всем
  finance?: boolean; // финансовый раздел — скрыт от ops-менеджеров
  seesAll?: boolean; // только расширенный доступ (директор + ops-менеджер)
  tasksAll?: boolean; // полный доступ к задачам (ТЗ 1.2 — включая Ироду)
}

/**
 * Разделов стало пятнадцать — плоским списком в них уже не сориентироваться,
 * поэтому меню сгруппировано по смыслу работы.
 */
interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Работа',
    items: [
      { to: '/', label: 'Дашборд', icon: LayoutDashboard },
      { to: '/funnel', label: 'Воронка', icon: Filter },
      { to: '/clients', label: 'Клиенты', icon: Users },
      { to: '/tasks', label: 'Задачи', icon: CheckSquare },
      // календарь задач — вместе с доступом к задачам, иначе доступ Ироды
      // получается наполовину нерабочим
      { to: '/calendar', label: 'Календарь', icon: CalendarRange, tasksAll: true },
      { to: '/schedule', label: 'Расписание', icon: CalendarDays },
    ],
  },
  {
    title: 'Операции',
    items: [
      { to: '/team', label: 'Команда', icon: UsersRound },
      { to: '/shifts', label: 'Смены и выезды', icon: Wallet },
      { to: '/checklists', label: 'Чек-листы', icon: ListChecks },
    ],
  },
  {
    title: 'Продажи',
    items: [
      { to: '/offers', label: 'Коммерческие предложения', icon: FileSignature },
      { to: '/reminders', label: 'Напоминания', icon: BellRing },
    ],
  },
  {
    title: 'Финансы',
    items: [
      { to: '/finance', label: 'Доходы и расходы', icon: Coins, roles: ['DIRECTOR'] },
      { to: '/reports', label: 'Ведомости', icon: FileText, finance: true },
      { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
    ],
  },
  {
    title: 'Управление',
    items: [
      { to: '/tariffs', label: 'Услуги и цены', icon: Tags, roles: ['DIRECTOR'] },
      { to: '/users', label: 'Сотрудники', icon: UserCog, roles: ['DIRECTOR'] },
      { to: '/history', label: 'История изменений', icon: History, seesAll: true },
      { to: '/trash', label: 'Корзина', icon: Trash2 },
      { to: '/security', label: 'Безопасность', icon: ShieldCheck, roles: ['DIRECTOR'] },
    ],
  },
];

export function Layout() {
  const { user, logout, logoutEverywhere } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // ops-менеджер (canManageOps) видит всё как директор, но БЕЗ финансовых разделов
  const isOps = !!user?.canManageOps && user.role !== 'DIRECTOR';
  const visible = (i: NavItem) => {
    if (i.roles && !(user && i.roles.includes(user.role))) return false;
    if (i.finance && isOps) return false;
    if (i.seesAll && !userSeesAll(user)) return false;
    if (i.tasksAll && !userManagesTasks(user)) return false;
    return true;
  };
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(visible),
  })).filter((g) => g.items.length > 0);

  // Прогрев кэша разделов после входа — переходы будут мгновенными.
  // На мобильном критично: НЕ греем на медленной/эконом-сети и разносим
  // запросы во времени, чтобы не забить канал и не задержать загрузку
  // текущей страницы (иначе «вечный спиннер» на LTE).
  useEffect(() => {
    if (!user) return;
    const conn = (navigator as any).connection;
    if (
      conn &&
      (conn.saveData || /(slow-2g|2g)$/.test(conn.effectiveType || ''))
    ) {
      return; // экономный режим / медленная сеть — прогрев пропускаем
    }
    const urls = [
      '/orders/board',
      '/clients?sort=recent',
      '/analytics/summary',
      '/tasks',
      '/schedule',
      '/cleaners',
      '/cleaners/team-tasks',
      '/brigades',
      '/reports',
      '/users/managers',
      '/reminders/counts',
      '/trash/counts',
    ];
    if (user.role === 'DIRECTOR') urls.push('/tariffs', '/users');

    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    let idleId: number | undefined;
    const kick = () => {
      if (i >= urls.length) return;
      prefetch(urls[i++]);
      timer = setTimeout(kick, 250); // по одному запросу раз в 250 мс
    };
    const start = () => {
      timer = setTimeout(kick, 600); // сначала даём загрузиться текущей странице
    };
    const w = window as any;
    if (w.requestIdleCallback) idleId = w.requestIdleCallback(start, { timeout: 2000 });
    else start();
    return () => {
      clearTimeout(timer);
      if (idleId !== undefined && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
    };
  }, [user]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleLogoutAll = async () => {
    setProfileOpen(false);
    await logoutEverywhere();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col bg-navy-500 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 px-5">
          <img
            src="/logo-white.png"
            alt="Archidea Cleaning"
            className="h-11 w-auto"
          />
          <span className="rounded-md bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
            CRM
          </span>
        </div>

        <nav className="mt-2 flex-1 overflow-y-auto px-3 py-2">
          {groups.map((group) => (
            <div key={group.title} className="mb-3 last:mb-0">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-white text-navy-900'
                          : 'text-white hover:bg-white/15'
                      }`
                    }
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 p-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white hover:bg-white/15"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Выйти
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-navy-950/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-navy-100 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            className="rounded-lg p-2 text-navy-600 hover:bg-navy-50 lg:hidden"
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="hidden text-sm text-navy-500 sm:block">
            {user?.role === 'DIRECTOR' ? 'Кабинет руководителя' : 'Кабинет менеджера'}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NotificationsBell />
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                className="flex items-center gap-2.5 rounded-xl p-1 transition-colors hover:bg-navy-50"
              >
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-semibold text-navy-900">
                    {user?.fullName}
                  </div>
                  <div className="text-xs text-navy-400">
                    {user?.role === 'DIRECTOR' ? 'Руководитель' : 'Менеджер'}
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-500 text-sm font-bold text-white">
                  {user?.fullName?.[0] ?? '?'}
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-navy-400 transition-transform ${profileOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {profileOpen && (
                <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-navy-100 bg-white py-1.5 shadow-card">
                  <div className="border-b border-navy-50 px-4 py-2.5">
                    <div className="truncate text-sm font-semibold text-navy-900">
                      {user?.fullName}
                    </div>
                    <div className="text-xs text-navy-400">@{user?.login}</div>
                  </div>
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      navigate(`/profile/${user?.id}`);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-navy-700 hover:bg-navy-50"
                  >
                    <UserCircle className="h-[18px] w-[18px] text-navy-500" />
                    Профиль
                  </button>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="h-[18px] w-[18px]" />
                    Выйти
                  </button>
                  <button
                    onClick={handleLogoutAll}
                    className="flex w-full items-start gap-2.5 border-t border-navy-50 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                    title="Погасит сессии на всех устройствах, включая украденные"
                  >
                    <ShieldOff className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                    <span>
                      Выйти со всех устройств
                      <span className="mt-0.5 block text-xs text-navy-400">
                        Если доступ мог попасть к чужим
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
