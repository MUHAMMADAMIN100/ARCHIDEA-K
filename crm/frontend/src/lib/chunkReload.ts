/**
 * Общий ключ и защита от циклической перезагрузки страницы при сбое
 * подгрузки чанков (code-splitting). Используется и в lazyWithRetry,
 * и в ErrorBoundary — ключ должен быть ОДИН на оба механизма.
 */
const RELOAD_KEY = 'chunk-reloaded-at';

/**
 * Метка в адресе делает ссылку уникальной, поэтому браузер обязан сходить
 * за свежим index.html, а не отдать сохранённую копию. Без неё обычная
 * перезагрузка в Safari (Mac, iPhone) возвращает ту же старую страницу со
 * ссылками на файлы, которых после нового выката уже нет, — и раздел
 * остаётся пустым сколько ни обновляй.
 */
const FRESH_MARK = '_v';

/** Адрес этой же страницы, но с новой меткой — гарантированно мимо кэша. */
function freshUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(FRESH_MARK, String(Date.now()));
  return url.toString();
}

/** Убираем служебную метку из адресной строки — человеку её видеть незачем. */
function stripFreshMark(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(FRESH_MARK)) return;
    url.searchParams.delete(FRESH_MARK);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') stripFreshMark();

/** Перезагрузить страницу для получения свежих чанков — не чаще раза в 10 сек. */
export function reloadForFreshChunks(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      window.location.replace(freshUrl());
    }
  } catch {
    window.location.replace(freshUrl());
  }
}

/**
 * Перезагрузка по кнопке «Обновить»: человек нажал сам, значит защиту от
 * зацикливания снимаем и идём за свежей версией без оглядки на кэш.
 */
export function reloadNow(): void {
  clearChunkReloadGuard();
  window.location.replace(freshUrl());
}

/** Сбросить защиту (после ручного «Обновить»). */
export function clearChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* ignore */
  }
}
