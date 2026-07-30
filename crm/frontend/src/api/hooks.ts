import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';

interface Options {
  /** Зависимости — при изменении перезагружает */
  deps?: any[];
  /** Интервал фонового авто-обновления, мс (живые данные без F5) */
  pollMs?: number;
  /**
   * Пока возвращает true — фоновое авто-обновление и refetch-при-фокусе
   * НЕ выполняются. Нужно, чтобы поллинг не перетирал оптимистичное
   * состояние во время незавершённой операции (напр. перетаскивание в воронке).
   */
  pollPaused?: () => boolean;
}

/**
 * Клиентский кэш ответов (stale-while-revalidate).
 * Благодаря ему повторный заход в раздел показывает данные МГНОВЕННО
 * (без спиннера), а свежие подгружаются в фоне.
 */
const cache = new Map<string, unknown>();

/** Очистка кэша (например, при выходе/входе — чтобы данные не «протекли») */
export function clearFetchCache() {
  cache.clear();
}

/**
 * Прогрев кэша в фоне (после входа) — чтобы даже первый заход
 * в раздел открывался мгновенно, без спиннера.
 */
export function prefetch(url: string) {
  if (cache.has(url)) return;
  api
    .get(url)
    .then((r) => cache.set(url, r.data))
    .catch(() => {});
}

/**
 * Точечно обновить закэшированные данные другого раздела (без его монтирования).
 * Используется, например, чтобы новая заявка мгновенно появилась в воронке
 * при добавлении клиента из другого раздела. Если кэша ещё нет — раздел
 * подтянет свежие данные сам при заходе.
 */
export function mutateCache<T>(url: string, updater: (prev: T) => T) {
  if (!cache.has(url)) return;
  cache.set(url, updater(cache.get(url) as T));
}

/**
 * Сбросить кэш по префиксу адреса — данные подтянутся заново при следующем заходе.
 *
 * Нужно там, где одна операция меняет данные СРАЗУ НЕСКОЛЬКИХ разделов и
 * пересчитать их локально нечем: перевод заказа в «Оплачено» создаёт запись
 * в финансах и меняет аналитику, закрытие смены — начисляет выплаты.
 * Без сброса пользователь увидел бы устаревшие цифры до перезагрузки страницы.
 */
export function invalidate(prefix: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

type Updater<T> = T | null | ((prev: T | null) => T | null);

/**
 * Загрузка данных с GET-эндпоинта.
 * - есть кэш по URL → показываем мгновенно, спиннера нет;
 * - нет кэша → спиннер только при самой первой загрузке;
 * - поллинг и refetch-при-фокусе обновляют «тихо».
 */
export function useFetch<T>(url: string | null, opts: Options = {}) {
  const { deps = [], pollMs } = opts;
  // держим актуальную функцию-паузу в ref, чтобы интервал/обработчики
  // всегда видели свежее значение без пересоздания эффектов
  const pausedRef = useRef(opts.pollPaused);
  pausedRef.current = opts.pollPaused;
  // счётчик поколений данных: растёт при каждой оптимистичной записи.
  // Фоновый GET, стартовавший ДО мутации, при возврате увидит другое
  // поколение и не перетрёт свежее локальное состояние/кэш устаревшим ответом.
  const dataGenRef = useRef(0);
  const [data, setData] = useState<T | null>(
    () => (url && cache.has(url) ? (cache.get(url) as T) : null),
  );
  const [loading, setLoading] = useState(() => !(url && cache.has(url)));
  const [error, setError] = useState<string | null>(null);

  // при смене URL — мгновенный сброс состояния прямо в рендере,
  // чтобы ни один кадр не показывал данные предыдущего URL
  const [prevUrl, setPrevUrl] = useState(url);
  if (prevUrl !== url) {
    setPrevUrl(url);
    setData(url && cache.has(url) ? (cache.get(url) as T) : null);
    setLoading(!(url && cache.has(url)));
    setError(null);
  }

  // защита от «отставших» ответов: ответ старого URL не должен
  // перезаписать данные нового
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(
    async (silent: boolean) => {
      if (!url) {
        setLoading(false);
        return;
      }
      const hasCache = cache.has(url);
      if (hasCache) {
        // мгновенно отдаём кэш, спиннер не показываем
        setData(cache.get(url) as T);
        setLoading(false);
      } else if (!silent) {
        setLoading(true);
      }
      const gen = dataGenRef.current;
      try {
        const res = await api.get<T>(url);
        // отставший ответ: между стартом запроса и его завершением произошла
        // оптимистичная мутация — не перетираем ни кэш, ни состояние.
        // Проверяем для ЛЮБОЙ загрузки (не только фоновой): первичная
        // тоже может завершиться уже после действия пользователя.
        if (dataGenRef.current !== gen) return;
        /*
         * Пустое тело ответа приводим к null.
         *
         * Nest на `return null` отдаёт 200 без тела, axios подставляет ''.
         * Пустая строка — не null и не undefined, поэтому `data?.items.length`
         * её НЕ отсекает и падает с «Cannot read properties of undefined».
         * Именно на этом рушилась вкладка «Чек-лист» и вся страница воронки.
         */
        const body = (res.data as unknown) === '' ? null : res.data;
        cache.set(url, body);
        if (urlRef.current !== url) return; // URL уже сменился — не трогаем состояние
        setData(body as T);
        setError(null);
      } catch (e: any) {
        if (urlRef.current !== url) return;
        if (!hasCache && !silent) {
          setError(e?.response?.data?.message || 'Ошибка загрузки');
        }
      } finally {
        if (urlRef.current === url) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, ...deps],
  );

  // первичная загрузка
  useEffect(() => {
    load(false);
  }, [load]);

  // фоновый поллинг (тихо) — пауза на скрытой вкладке и когда pollPaused()
  useEffect(() => {
    if (!pollMs || !url) return;
    const id = setInterval(() => {
      if (!document.hidden && !pausedRef.current?.()) load(true);
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, url, load]);

  // обновление при возврате на вкладку (тихо) — тоже уважает паузу
  useEffect(() => {
    if (!url) return;
    const onFocus = () => {
      if (!pausedRef.current?.()) load(true);
    };
    const onVis = () => {
      if (!document.hidden && !pausedRef.current?.()) load(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [url, load]);

  /** Тихая перезагрузка (для согласования после оптимистичной мутации) */
  const reload = useCallback(() => load(true), [load]);

  /** Обновление данных + синхронизация кэша (для оптимистичных мутаций) */
  const updateData = useCallback(
    (updater: Updater<T>) => {
      // помечаем новое поколение — отсекаем отставшие фоновые ответы
      dataGenRef.current += 1;
      setData((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: T | null) => T | null)(prev)
            : updater;
        if (url) {
          if (next == null) cache.delete(url);
          else cache.set(url, next);
        }
        return next;
      });
    },
    [url],
  );

  return { data, loading, error, reload, setData: updateData };
}
