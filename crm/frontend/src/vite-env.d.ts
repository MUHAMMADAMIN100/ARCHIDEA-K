/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Отметка сборки — подставляется Vite при сборке (см. vite.config.ts).
 * По ней видно прямо в кабинете, какая версия сейчас работает.
 */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_DATE__: string;
