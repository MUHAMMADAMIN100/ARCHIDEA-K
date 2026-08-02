import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Отметка сборки: дата и короткий номер коммита.
 *
 * Нужна, чтобы вопрос «правка доехала до сайта или нет» решался взглядом на
 * экран, а не спором. Один раз мы уже потеряли на этом время: правки лежали
 * в репозитории, а на сайте работала старая сборка — понять это можно было
 * только запросом к файлам сайта.
 *
 * Vercel не даёт истории git, но кладёт хеш коммита в переменную окружения;
 * локально спрашиваем сам git. Если ни того, ни другого нет — показываем
 * «dev», а не роняем сборку.
 */
function buildCommit(): string {
  const fromCI = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromCI) return fromCI.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

/**
 * Дата сборки по Душанбе (UTC+5), а не по Гринвичу.
 *
 * Серверы сборки живут в UTC: собранная днём 3 августа сборка получала бы
 * отметку «2026-08-02» и выглядела вчерашней у того, кто на неё смотрит.
 * Отметка нужна, чтобы снимать вопрос «свежее или нет», а не добавлять его.
 */
function buildDate(): string {
  const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;
  return new Date(Date.now() + DUSHANBE_OFFSET_MS).toISOString().slice(0, 10);
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_DATE__: JSON.stringify(buildDate()),
  },
});
