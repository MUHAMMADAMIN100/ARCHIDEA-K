/**
 * Развёртывание схемы базы при старте продакшена.
 *
 * Зачем нужен: раньше start:prod выполнял `prisma db push`, который приводит базу
 * к схеме без всякой истории — нет ни списка применённых изменений, ни отката.
 * Теперь используются обычные миграции Prisma, но переход на них требует
 * одноразового шага: сказать Prisma, что базовая схема (0_init) в базе уже есть.
 * Иначе `migrate deploy` попытается создать таблицы, которые давно созданы.
 *
 * Что делает:
 *   1. Если таблицы приложения есть, а истории миграций нет — база создана
 *      прежним `db push`; отмечаем 0_init как применённую (baseline).
 *   2. Снимаем зависшие миграции: запись без finished_at блокирует все
 *      последующие запуски `migrate deploy` до ручного вмешательства.
 *   3. Применяем миграции.
 *   4. Если применить не удалось, а деловых данных в базе ещё нет — приводим
 *      схему напрямую, чтобы сервис поднялся, и пишем причину в лог.
 *      При наличии реальных данных этот путь запрещён: молча ломать боевую
 *      базу хуже, чем не стартовать.
 *
 * Скрипт идемпотентен: повторный запуск ничего не портит.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const BASELINE = '0_init';

/** Имена миграций из каталога, по возрастанию — как их применяет Prisma */
function listMigrations() {
  const dir = path.join(__dirname, '..', 'prisma', 'migrations');
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Запуск Prisma CLI напрямую, а НЕ через npx.
 *
 * npx при отсутствии пакета лезет в сеть и тянет его с реестра: в контейнере
 * это либо долгий запуск, либо падение. Локальный бинарник — детерминированно.
 */
function prisma(args, { allowFail = false } = {}) {
  let cli;
  try {
    cli = require.resolve('prisma/build/index.js');
  } catch {
    throw new Error(
      'CLI Prisma не найден. Пакет prisma должен быть в dependencies, ' +
        'иначе на продакшене его не будет и миграции не применятся.',
    );
  }
  try {
    execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
    return true;
  } catch (e) {
    if (allowFail) return false;
    throw e;
  }
}

/** Состояние базы: читаем сырыми запросами — расхождение схемы с кодом не мешает */
async function inspect() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL не задан — развернуть базу невозможно');
  }

  const db = new PrismaClient();
  try {
    const [state] = await db.$queryRawUnsafe(
      `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS has_history,
              to_regclass('public."User"')              IS NOT NULL AS has_tables`,
    );

    // зависшие миграции: начали применяться и не завершились
    let stuck = [];
    if (state.has_history) {
      stuck = await db.$queryRawUnsafe(
        `SELECT migration_name FROM "_prisma_migrations"
          WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`,
      );
    }

    // деловые данные: если их нет, схему можно безопасно привести напрямую
    let hasBusinessData = false;
    if (state.has_tables) {
      try {
        const [counts] = await db.$queryRawUnsafe(
          `SELECT (SELECT COUNT(*) FROM "Client")
                + (SELECT COUNT(*) FROM "Order")
                + (SELECT COUNT(*) FROM "Report") AS total`,
        );
        hasBusinessData = Number(counts.total) > 0;
      } catch {
        // таблиц может не быть на самой ранней стадии — считаем, что данных нет
        hasBusinessData = false;
      }
    }

    return {
      hasHistory: Boolean(state.has_history),
      hasTables: Boolean(state.has_tables),
      stuck: stuck.map((r) => r.migration_name),
      hasBusinessData,
    };
  } finally {
    await db.$disconnect();
  }
}

(async () => {
  const state = await inspect();

  if (!state.hasHistory && state.hasTables) {
    console.log(
      `[db-deploy] Таблицы есть, истории миграций нет — отмечаю ${BASELINE} как применённую.`,
    );
    prisma(['migrate', 'resolve', '--applied', BASELINE], { allowFail: true });
  } else if (!state.hasHistory) {
    console.log('[db-deploy] База пустая — миграции создадут схему с нуля.');
  }

  for (const name of state.stuck) {
    console.warn(
      `[db-deploy] Миграция ${name} осталась незавершённой — помечаю откатившейся, чтобы разблокировать деплой.`,
    );
    prisma(['migrate', 'resolve', '--rolled-back', name], { allowFail: true });
  }

  const applied = prisma(['migrate', 'deploy'], { allowFail: true });
  if (applied) {
    console.log('[db-deploy] Схема базы актуальна.');
    return;
  }

  console.error('[db-deploy] Применить миграции не удалось (подробности выше).');

  if (state.hasBusinessData) {
    throw new Error(
      'В базе есть рабочие данные — привести схему в обход миграций нельзя. ' +
        'Разберите ошибку миграции выше и задеплойте заново.',
    );
  }

  console.warn(
    '[db-deploy] Деловых данных в базе нет — привожу схему напрямую, ' +
      'чтобы сервис поднялся. Историю миграций нужно будет восстановить.',
  );

  const pushed = prisma(['db', 'push', '--skip-generate', '--accept-data-loss'], {
    allowFail: true,
  });

  if (!pushed) {
    /*
     * Обычный push не всегда справляется: например, смену типа колонки
     * с перечисления на текст он выполнить не может и просит сброс.
     * База без деловых данных — сбрасываем и создаём схему заново.
     * Справочники, сотрудники и бригады система восстанавливает сама
     * при старте (setup и tariffs), пароли берутся из SEED_PW_<ЛОГИН>.
     */
    console.warn(
      '[db-deploy] Прямое обновление схемы невозможно — пересоздаю схему с нуля.',
    );
    prisma(['db', 'push', '--skip-generate', '--force-reset']);

    // история миграций после сброса пуста: отмечаем все имеющиеся миграции
    // применёнными, иначе следующий деплой снова попробует их накатить
    for (const name of listMigrations()) {
      prisma(['migrate', 'resolve', '--applied', name], { allowFail: true });
    }
  }

  console.log('[db-deploy] Схема приведена к текущему состоянию.');
})().catch((e) => {
  console.error('[db-deploy] Ошибка развёртывания схемы:', e.message || e);
  process.exit(1);
});
