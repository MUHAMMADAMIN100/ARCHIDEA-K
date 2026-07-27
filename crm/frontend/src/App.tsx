import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { userSeesAll } from './types';
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
const Schedule = lazyWithRetry(() => import('./pages/Schedule').then((m) => ({ default: m.Schedule })));
const Team = lazyWithRetry(() => import('./pages/Team').then((m) => ({ default: m.Team })));
const Shifts = lazyWithRetry(() => import('./pages/Shifts').then((m) => ({ default: m.Shifts })));
const Reports = lazyWithRetry(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const ReportEdit = lazyWithRetry(() => import('./pages/ReportEdit').then((m) => ({ default: m.ReportEdit })));
const ReportView = lazyWithRetry(() => import('./pages/ReportView').then((m) => ({ default: m.ReportView })));
const Analytics = lazyWithRetry(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));
const Tariffs = lazyWithRetry(() => import('./pages/Tariffs').then((m) => ({ default: m.Tariffs })));
const UsersPage = lazyWithRetry(() => import('./pages/Users').then((m) => ({ default: m.UsersPage })));
const UserDetail = lazyWithRetry(() => import('./pages/UserDetail').then((m) => ({ default: m.UserDetail })));

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
          <Route
            path="/calendar"
            element={
              <SeesAllOnly>
                <Calendar />
              </SeesAllOnly>
            }
          />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/team" element={<Team />} />
          <Route path="/shifts" element={<NoOpsFinance><Shifts /></NoOpsFinance>} />
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
          {/* Профиль/детали сотрудника — доступ контролирует бэкенд (руководитель или сам) */}
          <Route path="/profile/:id" element={<UserDetail />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
