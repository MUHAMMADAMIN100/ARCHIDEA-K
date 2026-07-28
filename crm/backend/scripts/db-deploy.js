/**
 * Развёртывание схемы базы при старте продакшена.
 *
 * Зачем нужен: раньше start:prod выполнял `prisma db push`, который приводит базу
 * к схеме без всякой истории — нет ни списка применённых изменений, ни отката.
 * Теперь используются обычные миграции Prisma, но переход на них требует
 * одноразового шага: сказать Prisma, что базовая схема (0_init) в базе уже есть.
 * Иначе `migrate deploy` попытается создать таблицы, которые давно созданы.
 *
 * Логика:
 *   1. Если таблицы _prisma_migrations нет, а таблицы приложения есть —
 *      база создана прежним `db push`. Отмечаем 0_init как применённую (baseline).
 *   2. Если нет ни того, ни другого — база пустая, baseline не нужен:
 *      migrate deploy создаст всё с нуля.
 *   3. В обоих случаях дальше выполняется `prisma migrate deploy`.
 *
 * Скрипт идемпотентен: повторный запуск ничего не ломает.
 */
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const BASELINE = '0_init';

function run(args) {
  execFileSync('npx', ['prisma', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

/**
 * Состояние базы читаем сырым запросом через Prisma Client: расхождение схемы
 * с кодом ему не мешает, отдельный драйвер Postgres в зависимостях не нужен.
 */
async function inspect() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL не задан — развернуть базу невозможно');
  }

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS has_history,
              to_regclass('public."User"')              IS NOT NULL AS has_tables`,
    );
    return rows[0];
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  const { has_history: hasHistory, has_tables: hasTables } = await inspect();

  if (!hasHistory && hasTables) {
    console.log(
      `[db-deploy] Таблицы есть, истории миграций нет — отмечаю ${BASELINE} как применённую (baseline).`,
    );
    run(['migrate', 'resolve', '--applied', BASELINE]);
  } else if (!hasHistory) {
    console.log('[db-deploy] База пустая — миграции создадут схему с нуля.');
  } else {
    console.log('[db-deploy] История миграций на месте.');
  }

  run(['migrate', 'deploy']);
  console.log('[db-deploy] Схема базы актуальна.');
})().catch((e) => {
  console.error('[db-deploy] Ошибка развёртывания схемы:', e.message || e);
  process.exit(1);
});
