import { Suspense, useEffect, useRef } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useLiveUpdates } from './api/live';
import { Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { userSeesReports, userSeesFinance, userSeesTrash } from './types';
import type { Role } from './types';

// Разделы грузятся по требованию (code-splitting) — тяжёлые библиотеки
// (recharts, dnd) не попадают в стартовый бандл и на страницу логина.
// lazyWithRetry — устойчивая загрузка чанков на мобильном/после деплоя.
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Funnel = lazyWithRetry(() => import('./pages/Funnel').then((m) => ({ default: m.Funnel })));
const Clients = lazyWithRetry(() => import('./pages/Clients').then((m) => ({ default: m.Clients })));
const ClientCard = lazyWithRetry(() => import('./pages/ClientCard').then((m) => ({ default: m.ClientCard })));
const Tasks = lazyWithRetry(() => import('./pages/Tasks').then((m) => ({ default: m.Tasks })));
const Calendar = lazyWithRetry(() => import('./pages/Calendar').then((m) => ({ default: m.Calendar })));
const Team = lazyWithRetry(() => import('./pages/Team').then((m) => ({ default: m.Team })));
const Shifts = lazyWithRetry(() => import('./pages/Shifts').then((m) => ({ default: m.Shifts })));
const Reports = lazyWithRetry(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const ReportEdit = lazyWithRetry(() => import('./pages/ReportEdit').then((m) => ({ default: m.ReportEdit })));
const ReportView = lazyWithRetry(() => import('./pages/ReportView').then((m) => ({ default: m.ReportView })));
const Analytics = lazyWithRetry(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));
const Tariffs = lazyWithRetry(() => import('./pages/Tariffs').then((m) => ({ default: m.Tariffs })));
const UsersPage = lazyWithRetry(() => import('./pages/Users').then((m) => ({ default: m.UsersPage })));
const UserDetail = lazyWithRetry(() => import('./pages/UserDetail').then((m) => ({ default: m.UserDetail })));
const Security = lazyWithRetry(() => import('./pages/Security').then((m) => ({ default: m.Security })));
// ── Разделы, добавленные по ТЗ ──
const Trash = lazyWithRetry(() => import('./pages/Trash').then((m) => ({ default: m.Trash })));
const Finance = lazyWithRetry(() => import('./pages/Finance').then((m) => ({ default: m.Finance })));
const History = lazyWithRetry(() => import('./pages/History').then((m) => ({ default: m.History })));
const Checklists = lazyWithRetry(() => import('./pages/Checklists').then((m) => ({ default: m.Checklists })));
const Offers = lazyWithRetry(() => import('./pages/Offers').then((m) => ({ default: m.Offers })));
const OfferView = lazyWithRetry(() => import('./pages/OfferView').then((m) => ({ default: m.OfferView })));
const Reminders = lazyWithRetry(() => import('./pages/Reminders').then((m) => ({ default: m.Reminders })));

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/**
 * Деньги компании: доходы и расходы.
 *
 * Не просто «роль DIRECTOR»: персональная галочка «без доступа к финансам»
 * сильнее роли, и руководитель с ней сюда тоже не попадёт — ни по ссылке
 * из меню, ни по прямому адресу. Ту же проверку делает сервер.
 */
function FinanceOnly({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user && !userSeesFinance(user)) return <Navigate to="/" replace />;
  return children;
}

/**
 * Платёжные ведомости.
 *
 * Закрыты не по роли, а по личной галочке «без доступа к финансам»: менеджер
 * ведомости составляет — это его работа. Но запрет перебивается второй
 * галочкой «но ведомости — открыть»: ведомость это рабочий документ, а не
 * книга доходов компании. Ту же проверку делает сервер.
 */
function MoneyBanned({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user && !userSeesReports(user)) return <Navigate to="/" replace />;
  return children;
}

function RoleOnly({
  roles,
  children,
}: {
  roles: Role[];
  children: JSX.Element;
}) {
  const { user } = useAuth();
  if (user && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

/**
 * Корзина закрыта не только в меню, но и по адресу: иначе раздел
 * открывался бы прямой ссылкой у любого, кто её знает.
 */
function TrashOnly({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user && !userSeesTrash(user)) return <Navigate to="/" replace />;
  return children;
}

/**
 * Начальный экран — всегда воронка.
 *
 * Браузер восстанавливает вчерашнюю вкладку: сотрудник открывал CRM и
 * попадал на «Аналитику», где закрыл её накануне, хотя работа начинается
 * с воронки. Один раз за загрузку страницы уводим на неё — но только с
 * «случайного» адреса: ссылки из уведомлений и Телеграма (карточка заказа,
 * задача, ведомость) должны открываться там, куда ведут.
 */
function StartOnFunnel({ ready }: { ready: boolean }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    // адрес с параметрами — это переход по ссылке, его не трогаем
    if (search) return;
    // разделы верхнего уровня без параметров считаем «восстановленной вкладкой»
    const deepLink = pathname.split('/').filter(Boolean).length > 1;
    if (deepLink || pathname === '/') return;
    navigate('/', { replace: true });
  }, [ready, pathname, search, navigate]);

  return null;
}

export default function App() {
  const { user, loading } = useAuth();
  /*
   * Живой канал изменений держим одним соединением на вкладку и только
   * для вошедшего сотрудника: до входа обновлять нечего, а соединение
   * без авторизации сервер всё равно не примет.
   */
  useLiveUpdates(!!user, user?.id);

  return (
    <ErrorBoundary>
      <StartOnFunnel ready={!loading && !!user} />
      <Suspense fallback={<Spinner />}>
        <Routes>
        <Route
          path="/login"
          element={
            loading ? (
              <Spinner />
            ) : user ? (
              <Navigate to="/" replace />
            ) : (
              <Login />
            )
          }
        />

        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          {/*
            Корень CRM — ВОРОНКА (решение владельца): с неё начинается работа
            у всех ролей, и открывать её лишним нажатием после каждого входа
            бессмысленно. Дашборд никуда не делся — он живёт по своему адресу
            и открывается из меню.

            Прежний адрес дашборда («/») уводит на воронку сам собой: старые
            закладки и ссылки из уведомлений не ломаются, просто открывают
            рабочий экран.
          */}
          <Route path="/" element={<Funnel />} />
          {/*
            Прежний адрес воронки остаётся рабочим и открывает её же. Не
            перенаправляем на корень: с воронкой ходят метки вида «?order=…»
            и «?stage=…» из дашборда и уведомлений, а перенаправление их
            отбросило бы — нужная карточка не открылась бы.
          */}
          <Route path="/funnel" element={<Funnel />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientCard />} />
          <Route path="/tasks" element={<Tasks />} />
          {/* Календарь открыт всем: сотрудник ведёт в нём свои звонки и выезды.
              Чужие задачи в него попадают только у тех, кто ведёт задачи
              компании — это решает бэкенд, а не маршрут. */}
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/team" element={<Team />} />
          {/* Смены и выезды — операционный раздел: адрес, состав группы,
              кто куда ездил. Суммы внутри вырезает бэкенд (ТЗ 4). */}
          <Route path="/shifts" element={<Shifts />} />
          {/* Ведомости: сотрудник видит и составляет только свои — область
              данных ограничивает сервер. Закрыты они лишь тому, кому владелец
              снял доступ к деньгам: в ведомости и цена заказа, и выплаты. */}
          <Route
            path="/reports"
            element={
              <MoneyBanned>
                <Reports />
              </MoneyBanned>
            }
          />
          <Route
            path="/reports/new"
            element={
              <MoneyBanned>
                <ReportEdit />
              </MoneyBanned>
            }
          />
          <Route
            path="/reports/:id"
            element={
              <MoneyBanned>
                <ReportView />
              </MoneyBanned>
            }
          />
          <Route
            path="/reports/:id/edit"
            element={
              <MoneyBanned>
                <ReportEdit />
              </MoneyBanned>
            }
          />
          <Route path="/analytics" element={<Analytics />} />
          {/* Услуги и цены — рабочий справочник компании, открыт всем сотрудникам */}
          <Route path="/tariffs" element={<Tariffs />} />
          <Route
            path="/users"
            element={
              <RoleOnly roles={['DIRECTOR']}>
                <UsersPage />
              </RoleOnly>
            }
          />
          <Route
            path="/security"
            element={
              <RoleOnly roles={['DIRECTOR']}>
                <Security />
              </RoleOnly>
            }
          />
          {/* ── Разделы, добавленные по ТЗ ── */}
          {/* Корзина — по личному праву сотрудника; очистка внутри — только руководителю */}
          <Route
            path="/trash"
            element={
              <TrashOnly>
                <Trash />
              </TrashOnly>
            }
          />
          {/* Книга доходов и расходов — только руководителю: это деньги
              компании целиком. Раньше пункт был открыт менеджерам, и они
              упирались в 403 на уже показанной им странице. */}
          <Route
            path="/finance"
            element={
              <FinanceOnly>
                <Finance />
              </FinanceOnly>
            }
          />
          {/* История изменений: сотруднику показываются его собственные
              действия, руководству — вся лента. Отбор делает бэкенд. */}
          <Route path="/history" element={<History />} />
          <Route path="/checklists" element={<Checklists />} />
          <Route path="/offers" element={<Offers />} />
          <Route path="/offers/:id" element={<OfferView />} />
          <Route path="/reminders" element={<Reminders />} />

          {/* Профиль/детали сотрудника — доступ контролирует бэкенд (руководитель или сам) */}
          <Route path="/profile/:id" element={<UserDetail />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
