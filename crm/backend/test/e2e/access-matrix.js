/**
 * Матрица доступа: каждый раздел CRM под руководителем и под менеджером.
 *
 * Проверяется не «отвечает ли API», а совпадает ли фактический доступ с
 * решением владельца: менеджер работает как руководитель во всём, кроме
 * доходов и расходов, сотрудников, журнала безопасности и корзины.
 *
 * Два класса дефектов, которые ловит этот файл:
 *   - утечка: менеджер получил то, что ему закрыто;
 *   - ложный запрет: раздел показан в меню, но API отвечает 403, и человек
 *     упирается в «не работает» на уже открытом экране.
 */
const {
  assertLocal,
  login,
  call,
  createReporter,
} = require('./helpers');

/** [путь, ожидание для руководителя, ожидание для менеджера] */
const ENDPOINTS = [
  // общие разделы — открыты обоим
  ['/auth/me', 'ok', 'ok'],
  ['/orders', 'ok', 'ok'],
  ['/orders/board', 'ok', 'ok'],
  ['/clients', 'ok', 'ok'],
  ['/clients/export', 'ok', 'ok'],
  ['/tasks', 'ok', 'ok'],
  ['/cleaners', 'ok', 'ok'],
  ['/cleaners/team-tasks', 'ok', 'ok'],
  ['/brigades', 'ok', 'ok'],
  ['/shift-groups', 'ok', 'ok'],
  ['/payroll/shifts', 'ok', 'ok'],
  ['/reports', 'ok', 'ok'],
  ['/analytics/summary', 'ok', 'ok'],
  ['/analytics/full', 'ok', 'ok'],
  ['/tariffs', 'ok', 'ok'],
  ['/tariffs/manage', 'ok', 'ok'],
  ['/users/managers', 'ok', 'ok'],
  ['/users/assignable', 'ok', 'ok'],
  ['/audit', 'ok', 'ok'],
  ['/notifications', 'ok', 'ok'],
  ['/notifications/unread-count', 'ok', 'ok'],
  ['/checklist-templates', 'ok', 'ok'],
  ['/proposals', 'ok', 'ok'],
  ['/proposal-templates', 'ok', 'ok'],
  ['/reminders', 'ok', 'ok'],
  ['/reminders/counts', 'ok', 'ok'],
  ['/telegram/status', 'ok', 'ok'],
  // закрыто от менеджера — деньги компании
  ['/payroll', 'ok', 'deny'],
  ['/payroll/fines', 'ok', 'deny'],
  ['/finance', 'ok', 'deny'],
  ['/finance/summary', 'ok', 'deny'],
  ['/finance/categories', 'ok', 'deny'],
  ['/bonuses', 'ok', 'deny'],
  // закрыто от менеджера — управление доступами и архив
  ['/users', 'ok', 'deny'],
  ['/auth/login-attempts', 'ok', 'deny'],
  ['/trash/counts', 'ok', 'deny'],
  ['/trash', 'ok', 'deny'],
];

const passes = (expected, status) =>
  expected === 'ok' ? status >= 200 && status < 300 : status === 403;

async function main() {
  assertLocal();
  const report = createReporter();

  const dir = await login('director');
  const mgr = await login('manager');

  console.log(
    `РУКОВОДИТЕЛЬ @${dir.login}: ${dir.user.fullName} | корзина ${dir.user.canSeeTrash}`,
  );
  console.log(
    `МЕНЕДЖЕР     @${mgr.login}: ${mgr.user.fullName} | общая база ${mgr.user.canManageOps}`,
  );
  if (dir.user.role !== 'DIRECTOR') {
    throw new Error(`@${dir.login} должен быть руководителем, а он ${dir.user.role}`);
  }
  if (mgr.user.role !== 'MANAGER') {
    throw new Error(`@${mgr.login} должен быть менеджером, а он ${mgr.user.role}`);
  }

  report.section('ДОСТУП К РАЗДЕЛАМ');
  console.log('  ' + 'ЭНДПОИНТ'.padEnd(30) + 'РУК.'.padEnd(10) + 'МЕНЕДЖЕР');
  for (const [path, expDir, expMgr] of ENDPOINTS) {
    const d = await call(dir, 'GET', path);
    const m = await call(mgr, 'GET', path);
    const dOk = passes(expDir, d.status);
    const mOk = passes(expMgr, m.status);
    const line =
      path.padEnd(30) +
      String(d.status).padEnd(10) +
      String(m.status) +
      (expMgr === 'deny' ? ' (ждём 403)' : '');
    console.log(`${dOk && mOk ? '  OK ' : ' !! '} ${line}`);
    if (!dOk) {
      report.check(false, `РУКОВОДИТЕЛЬ ${path}`, `${d.status}, ждали ${expDir === 'ok' ? '2xx' : '403'}`);
    }
    if (!mOk) {
      report.check(false, `МЕНЕДЖЕР ${path}`, `${m.status}, ждали ${expMgr === 'ok' ? '2xx' : '403'}`);
    }
  }

  report.section('СТАВКИ КЛИНЕРОВ — ЗАРПЛАТА, А НЕ ОПЕРАЦИОННЫЕ ДАННЫЕ');
  const dirCleaners = (await call(dir, 'GET', '/cleaners')).data ?? [];
  const mgrCleaners = (await call(mgr, 'GET', '/cleaners')).data ?? [];
  report.check(
    dirCleaners.some((c) => c.rate !== undefined),
    'Руководитель ставки видит',
  );
  report.check(
    mgrCleaners.every((c) => c.rate === undefined),
    'Менеджеру ставки не приходят',
  );
  const mgrBrigades = (await call(mgr, 'GET', '/brigades')).data ?? [];
  report.check(
    mgrBrigades.every((b) => (b.cleaners ?? []).every((c) => c.rate === undefined)),
    'В составе бригад ставок тоже нет',
  );
  const mgrShifts = (await call(mgr, 'GET', '/payroll/shifts')).data ?? [];
  report.check(
    mgrShifts.every((s) => s.rate === undefined),
    'В списке смен начислений тоже нет',
  );

  report.section('ВЫРУЧКА КОМПАНИИ');
  const mgrFull = (await call(mgr, 'GET', '/analytics/full')).data;
  const dirFull = (await call(dir, 'GET', '/analytics/full')).data;
  report.check(dirFull?.revenue !== undefined, 'Руководитель выручку видит');
  report.check(mgrFull?.revenue === undefined, 'Менеджеру выручка не приходит');
  const mgrSummary = (await call(mgr, 'GET', '/analytics/summary')).data;
  report.check(
    mgrSummary?.revenueMonth === undefined,
    'Выручки месяца на дашборде менеджера нет',
  );

  report.section('ЖУРНАЛ ИЗМЕНЕНИЙ — ТОЛЬКО СВОИ ДЕЙСТВИЯ');
  const audit = (await call(mgr, 'GET', '/audit')).data;
  const foreign = (audit?.items ?? []).filter(
    (i) => i.actorId && i.actorId !== mgr.user.id,
  );
  report.check(foreign.length === 0, 'Чужих записей в ленте нет', `${foreign.length} шт.`);

  report.section('ЗАДАЧИ — ТОЛЬКО СЕБЕ');
  const assignable = (await call(mgr, 'GET', '/users/assignable')).data ?? [];
  report.check(
    assignable.length === 1 && assignable[0].id === mgr.user.id,
    'В списке исполнителей менеджер видит только себя',
    `${assignable.length} чел.`,
  );
  const foreignTask = await call(mgr, 'POST', '/tasks', {
    title: 'Проверка: задача чужому',
    type: 'CALL',
    priority: 'MEDIUM',
    assigneeIds: [dir.user.id],
  });
  report.check(foreignTask.status === 403, 'Задачу чужому поставить нельзя', String(foreignTask.status));

  report.section('ПОВЫШЕНИЕ СЕБЯ В ПРАВАХ');
  const promote = await call(mgr, 'PATCH', `/users/${mgr.user.id}`, {
    role: 'DIRECTOR',
  });
  report.check(
    promote.status === 403,
    'Менеджер не может сделать себя руководителем (иначе запрет на финансы бессмыслен)',
    String(promote.status),
  );

  process.exit(report.finish('ДОСТУП СОВПАДАЕТ С РЕШЕНИЕМ ВЛАДЕЛЬЦА'));
}

main().catch((e) => {
  console.error('\nСБОЙ ПРОВЕРКИ:', e.message);
  process.exit(1);
});
