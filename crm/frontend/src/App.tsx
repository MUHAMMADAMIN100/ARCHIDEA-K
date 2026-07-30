import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { userManagesTasks, userSeesAll, userSeesTrash } from './types';
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

/** Финансовые разделы — скрыты от ops-менеджеров (директор и обычные менеджеры видят) */
function NoOpsFinance({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user && user.canManageOps && user.role !== 'DIRECTOR') {
    return <Navigate to="/" replace />;
  }
  return children;
}

/** Разделы для расширенного доступа: директор + ops-менеджер */
function SeesAllOnly({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user && !userSeesAll(user)) return <Navigate to="/" replace />;
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
 * Полный доступ к модулю задач (ТЗ 1.2).
 * Директор, ops-менеджер и сотрудники с личным флагом canManageTasks (Ирода).
 */
function TasksAccessOnly({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user && !userManagesTasks(user)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <ErrorBoundary>
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
          <Route path="/" element={<Dashboard />} />
          <Route path="/funnel" element={<Funnel />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientCard />} />
          <Route path="/tasks" element={<Tasks />} />
          {/* Календарь задач идёт вместе с доступом к задачам: иначе полный
              доступ Ироды получается наполовину нерабочим */}
          <Route
            path="/calendar"
            element={
              <TasksAccessOnly>
                <Calendar />
              </TasksAccessOnly>
            }
          />
          <Route path="/team" element={<Team />} />
          {/* Смены и выезды — операционный раздел: адрес, состав группы,
              кто куда ездил. Денежные вкладки внутри скрыты от ops-менеджера
              отдельно, а сам раздел ему нужен по работе (ТЗ 4). */}
          <Route path="/shifts" element={<Shifts />} />
          <Route path="/reports" element={<NoOpsFinance><Reports /></NoOpsFinance>} />
          <Route path="/reports/new" element={<NoOpsFinance><ReportEdit /></NoOpsFinance>} />
          <Route path="/reports/:id" element={<NoOpsFinance><ReportView /></NoOpsFinance>} />
          <Route path="/reports/:id/edit" element={<NoOpsFinance><ReportEdit /></NoOpsFinance>} />
          <Route path="/analytics" element={<Analytics />} />
          <Route
            path="/tariffs"
            element={
              <RoleOnly roles={['DIRECTOR']}>
                <Tariffs />
              </RoleOnly>
            }
          />
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
              <RoleOnly roles={['DIRECTOR']}>
                <Finance />
              </RoleOnly>
            }
          />
          <Route path="/history" element={<SeesAllOnly><History /></SeesAllOnly>} />
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
