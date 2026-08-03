import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  MoreHorizontal,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { NotificationsBell } from './NotificationsBell';
import { StuckSentinel, useStuck } from './ScrollArea';
import { userFinanceBanned, userSeesFinance, userSeesTrash } from '../types';
import type { Role } from '../types';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: Role[]; // если не указано — доступно всем сотрудникам
  trash?: boolean; // корзина — руководитель с личным правом
  finance?: boolean; // деньги компании — скрыто по галочке «без доступа к финансам»
  /*
   * Раздел с деньгами, который менеджеру по работе нужен (платёжные
   * ведомости): он остаётся у всех, кроме сотрудника с личной галочкой
   * «без доступа к финансам».
   */
  moneyBan?: boolean;
}

/**
 * Разделов стало пятнадцать — плоским списком в них уже не сориентироваться,
 * поэтому меню сгруппировано по смыслу работы.
 *
 * Правило доступа простое: сотрудник работает во всех разделах, кроме денег
 * компании и управления доступами. Закрыты ровно четыре пункта — «Доходы и
 * расходы», «Сотрудники», «Безопасность» и «Корзина»; всё остальное открыто.
 * Внутри общих разделов суммы (ставки, выплаты, выручка) прячет бэкенд.
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
      { to: '/calendar', label: 'Календарь', icon: CalendarRange },
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
      { to: '/finance', label: 'Доходы и расходы', icon: Coins, roles: ['DIRECTOR'], finance: true },
      { to: '/reports', label: 'Ведомости', icon: FileText, moneyBan: true },
      { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
    ],
  },
  {
    title: 'Управление',
    items: [
      { to: '/tariffs', label: 'Услуги и цены', icon: Tags },
      { to: '/users', label: 'Сотрудники', icon: UserCog, roles: ['DIRECTOR'] },
      { to: '/history', label: 'История изменений', icon: History },
      { to: '/trash', label: 'Корзина', icon: Trash2, trash: true },
      { to: '/security', label: 'Безопасность', icon: ShieldCheck, roles: ['DIRECTOR'] },
    ],
  },
];

/**
 * Кабинет руководителя: семь разделов по важности и пункт «Ещё».
 *
 * У руководителя семнадцать разделов, и плоским списком из пяти групп было
 * не понять, что проверять каждый день. Наверх вынесено то, на что владелец
 * смотрит регулярно; остальное убрано за «Ещё» и разложено по смыслу.
 * У менеджеров навигация прежняя — их работа устроена иначе.
 */
const DIRECTOR_NAV: NavItem[] = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/finance', label: 'Доходы и расходы', icon: Coins, roles: ['DIRECTOR'], finance: true },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { to: '/funnel', label: 'Воронка', icon: Filter },
  { to: '/clients', label: 'Клиенты', icon: Users },
  { to: '/reports', label: 'Ведомости', icon: FileText, moneyBan: true },
];

/** Что лежит за пунктом «Ещё» — две группы с неклика­бельными заголовками */
const MORE_GROUPS: NavGroup[] = [
  {
    title: 'Операции',
    items: [
      { to: '/tasks', label: 'Задачи', icon: CheckSquare },
      { to: '/calendar', label: 'Календарь', icon: CalendarRange },
      { to: '/team', label: 'Команда', icon: UsersRound },
      { to: '/shifts', label: 'Смены и выезды', icon: Wallet },
      { to: '/checklists', label: 'Чек-листы', icon: ListChecks },
      { to: '/offers', label: 'Коммерческие предложения', icon: FileSignature },
      { to: '/reminders', label: 'Напоминания', icon: BellRing },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { to: '/tariffs', label: 'Услуги и цены', icon: Tags },
      { to: '/users', label: 'Сотрудники', icon: UserCog, roles: ['DIRECTOR'] },
      { to: '/history', label: 'История изменений', icon: History },
      { to: '/security', label: 'Безопасность', icon: ShieldCheck, roles: ['DIRECTOR'] },
      { to: '/trash', label: 'Корзина', icon: Trash2, trash: true },
    ],
  },
];

/** Пункт меню: одна разметка на оба кабинета */
function NavItemLink({
  item,
  onClick,
}: {
  item: NavItem;
  onClick: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        `press flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-[background-color,color,transform] duration-120 ease-out ${
          isActive ? 'bg-white text-navy-900' : 'text-white hover:bg-white/15'
        }`
      }
    >
      <item.icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

export function Layout() {
  const { user, logout, logoutEverywhere } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  // шапка отбрасывает тень только когда под ней уже проехало содержимое —
  // так видно, что страница длиннее экрана и вы не в её начале
  const { ref: headerRef, sentinelRef } = useStuck<HTMLElement>();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /*
   * Пока открыто боковое меню, страница под ним не прокручивается.
   *
   * Раньше палец по списку разделов двигал не список, а страницу за ним:
   * меню оставалось на месте, а содержимое под ним уезжало. Запираем
   * прокрутку страницы на время, пока меню открыто.
   */
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const visible = (i: NavItem) => {
    if (i.roles && !(user && i.roles.includes(user.role))) return false;
    if (i.trash && !userSeesTrash(user)) return false;
    // персональный запрет на финансы сильнее роли: галочка в карточке
    // сотрудника убирает денежные разделы даже у руководителя
    if (i.finance && !userSeesFinance(user)) return false;
    if (i.moneyBan && userFinanceBanned(user)) return false;
    return true;
  };
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(visible),
  })).filter((g) => g.items.length > 0);

  /*
   * Кабинет руководителя: семь пунктов и «Ещё». Список за «Ещё»
   * раскрывается прямо в сайдбаре — это привычнее выпадающей панели и
   * одинаково работает на телефоне.
   */
  const isDirector = user?.role === 'DIRECTOR';
  const topNav = DIRECTOR_NAV.filter(visible);
  const moreGroups = MORE_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(visible),
  })).filter((g) => g.items.length > 0);
  const morePaths = moreGroups.flatMap((g) => g.items.map((i) => i.to));
  // открыт раздел изнутри «Ещё» — пункт подсвечен, список раскрыт
  const insideMore = morePaths.some(
    (path) => location.pathname === path || location.pathname.startsWith(path + '/'),
  );
  const [moreOpen, setMoreOpen] = useState(insideMore);
  useEffect(() => {
    if (insideMore) setMoreOpen(true);
  }, [insideMore]);

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
      '/cleaners',
      '/cleaners/team-tasks',
      '/brigades',
      '/reports',
      '/users/managers',
      '/reminders/counts',
      '/tariffs',
    ];
    // разделы, закрытые от менеджеров: греть их всем — значит гарантированно
    // получить 403 на каждом входе и зашумить журнал сервера
    if (userSeesTrash(user)) urls.push('/trash/counts');
    if (user.role === 'DIRECTOR') urls.push('/users');

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
        // на телефоне меню выезжает поверх страницы — тень показывает, что оно
        // висит над содержимым; на десктопе оно стоит в потоке, там тени нет
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col bg-brand-500 text-white shadow-pop transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shadow-none ${
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

        {/* overscroll-contain: список докрутили до края — страница за ним не едет */}
        <nav className="mt-2 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {isDirector ? (
            <>
              <div className="space-y-1">
                {topNav.map((item) => (
                  <NavItemLink
                    key={item.to}
                    item={item}
                    onClick={() => setMobileOpen(false)}
                  />
                ))}

                {/* «Ещё» — вход в разделы, нужные точечно, а не каждый день */}
                <button
                  type="button"
                  onClick={() => setMoreOpen((o) => !o)}
                  className={`press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-[background-color,color,transform] duration-120 ease-out ${
                    insideMore
                      ? 'bg-white text-navy-900'
                      : 'text-white hover:bg-white/15'
                  }`}
                >
                  <MoreHorizontal className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">Ещё</span>
                  <ChevronDown
                    className={`ml-auto h-4 w-4 shrink-0 transition-transform ${
                      moreOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </div>

              {moreOpen &&
                moreGroups.map((group) => (
                  <div key={group.title} className="mt-3">
                    {/* заголовок группы — только разделитель, не ссылка */}
                    <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
                      {group.title}
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => (
                        <NavItemLink
                          key={item.to}
                          item={item}
                          onClick={() => setMobileOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </>
          ) : (
            groups.map((group) => (
              <div key={group.title} className="mb-3 last:mb-0">
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  {group.title}
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <NavItemLink
                      key={item.to}
                      item={item}
                      onClick={() => setMobileOpen(false)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </nav>

        <div className="shrink-0 p-3">
          <button
            onClick={handleLogout}
            className="press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white hover:bg-white/15"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Выйти
          </button>

          {/*
            Отметка сборки. Мелко и ненавязчиво, но по ней сразу видно, какая
            версия открыта. Нужна после случая, когда правки лежали в
            репозитории, а на сайте работала старая сборка — и выяснить это
            можно было только запросом к файлам сайта.
          */}
          <div
            className="mt-2 select-text px-3 text-center text-[10px] leading-tight text-white/35"
            title="Версия сборки — назовите её, если что-то работает не так"
          >
            {__BUILD_DATE__} · {__BUILD_COMMIT__}
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 animate-fade-in bg-navy-950/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <StuckSentinel sentinelRef={sentinelRef} />
        <header
          ref={headerRef}
          className="sticky-head flex h-16 items-center justify-between gap-3 border-b border-navy-100 bg-white px-4 sm:px-6"
        >
          <button
            className="press rounded-lg p-2 text-navy-600 hover:bg-navy-50 lg:hidden"
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="hidden text-sm text-navy-600 sm:block">
            {user?.role === 'DIRECTOR' ? 'Кабинет руководителя' : 'Кабинет менеджера'}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NotificationsBell />
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                className="press flex items-center gap-2.5 rounded-xl p-1 transition-[background-color,transform] duration-120 ease-out hover:bg-navy-50"
              >
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-semibold text-navy-900">
                    {user?.fullName}
                  </div>
                  <div className="text-xs text-navy-600">
                    {user?.role === 'DIRECTOR' ? 'Руководитель' : 'Менеджер'}
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-500 text-sm font-bold text-white">
                  {user?.fullName?.[0] ?? '?'}
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-navy-600 transition-transform ${profileOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {profileOpen && (
                <div className="absolute right-0 z-50 mt-2 w-52 animate-drop-in overflow-hidden rounded-2xl border border-navy-100 bg-white py-1.5 shadow-pop">
                  <div className="border-b border-navy-50 px-4 py-2.5">
                    <div className="truncate text-sm font-semibold text-navy-900">
                      {user?.fullName}
                    </div>
                    <div className="text-xs text-navy-600">@{user?.login}</div>
                  </div>
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      navigate(`/profile/${user?.id}`);
                    }}
                    className="press flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-navy-700 hover:bg-navy-50"
                  >
                    <UserCircle className="h-[18px] w-[18px] text-navy-600" />
                    Профиль
                  </button>
                  <button
                    onClick={handleLogout}
                    className="press flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="h-[18px] w-[18px]" />
                    Выйти
                  </button>
                  <button
                    onClick={handleLogoutAll}
                    className="press flex w-full items-start gap-2.5 border-t border-navy-50 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                    title="Погасит сессии на всех устройствах, включая украденные"
                  >
                    <ShieldOff className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                    <span>
                      Выйти со всех устройств
                      <span className="mt-0.5 block text-xs text-navy-600">
                        Если доступ мог попасть к чужим
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/*
          Отступы просторнее на большом экране: между карточками и краем
          страницы стало больше воздуха, и сетка не выглядит забитой.
          На телефоне оставлены прежними — там плотность важнее вида,
          иначе в экран помещается на треть меньше заказов.
        */}
        <main className="flex-1 p-4 sm:p-7 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
