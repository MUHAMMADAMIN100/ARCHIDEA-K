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

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
