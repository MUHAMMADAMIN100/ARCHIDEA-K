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
/**
 * Оптимистичное действие: экран меняется сразу, запрос уходит фоном.
 *
 * Правило простое: пользователь не должен ждать сеть, чтобы увидеть
 * результат своего нажатия. Если сервер откажет — возвращаем прежнее
 * состояние и говорим, почему.
 *
 * Возвращает промис на случай, когда вызывающему нужно дождаться конца
 * (например, чтобы перейти на страницу созданной записи). Ждать его
 * необязательно — интерфейс уже обновлён.
 */
export async function optimistic<T>(opts: {
  /** setData из useFetch того списка, который меняем */
  setData: (updater: Updater<T>) => void;
  /** как изменить данные локально, прямо сейчас */
  apply: (prev: T | null) => T | null;
  /** сам запрос к серверу */
  request: () => Promise<unknown>;
  /** сообщить об отказе — обычно toast.error */
  onError?: (message: string) => void;
  /** обновить данные после успеха (подтянуть настоящие id и суммы) */
  onSettled?: () => void;
}): Promise<boolean> {
  let previous: T | null = null;
  opts.setData((prev) => {
    previous = prev as T | null;
    return opts.apply(prev as T | null);
  });
  try {
    await opts.request();
    opts.onSettled?.();
    return true;
  } catch (e: any) {
    // откат: возвращаем ровно то, что было до нажатия
    opts.setData(previous);
    opts.onError?.(
      e?.response?.data?.message || 'Не удалось сохранить. Попробуйте ещё раз',
    );
    return false;
  }
}

export function mutateCache<T>(url: string, updater: (prev: T) => T) {
  if (!cache.has(url)) return;
  cache.set(url, updater(cache.get(url) as T));
}

/*
 * ─────────── Защита от «удалённая запись вернулась» ───────────
 *
 * Экраны обновляются сами: по таймеру, при возврате на вкладку, по событию
 * с сервера и просто при заходе в раздел. Такой запрос легко обгоняет ещё
 * не дошедшее до сервера удаление — сервер честно отдаёт запись, которая на
 * экране уже убрана, и она возвращается. Именно поэтому удалённая ведомость
 * появлялась снова и исчезала только после обновления страницы.
 *
 * Поэтому пока идёт изменение данных, ответы на ЧТЕНИЕ не принимаются: они
 * заведомо описывают состояние «до». Показанное на экране при этом не
 * страдает — оно берётся из кэша, а свежее подтянется сразу после того, как
 * сервер подтвердит изменение.
 *
 * Счётчик общий на всё приложение, потому что гонка бывает и между разными
 * экранами: удаляют в карточке, а возвращает запись список, который в этот
 * момент открывается.
 */
let mutationsInFlight = 0;
let mutationGeneration = 0;

/** Началось изменение данных */
function beginMutation(): void {
  mutationsInFlight += 1;
  mutationGeneration += 1;
}

/** Изменение закончилось — успехом или отказом, неважно */
function endMutation(): void {
  mutationsInFlight = Math.max(0, mutationsInFlight - 1);
  mutationGeneration += 1;
}

/**
 * Устарел ли ответ на чтение, начатый при поколении `startedAt`.
 *
 * Устарел, если за время запроса что-то меняли или меняют прямо сейчас.
 */
function readIsStale(startedAt: number): boolean {
  return mutationsInFlight > 0 || mutationGeneration !== startedAt;
}

/**
 * Выполнить ИЗМЕНЕНИЕ данных под защитой от гонки с чтением.
 *
 * Нужно там, где операция состоит из НЕСКОЛЬКИХ запросов подряд: создание
 * клиента с заявкой — это POST клиента и следом POST заказа. Живой канал
 * узнаёт о первом запросе и перечитывает доску ДО того, как второй дошёл до
 * сервера, — временная карточка на секунду перетиралась ответом без заказа
 * и «мигала». Пока функция не завершилась, ответы на чтение не принимаются
 * (см. readIsStale) — мигать нечему.
 */
export async function withMutation<T>(fn: () => Promise<T>): Promise<T> {
  beginMutation();
  try {
    return await fn();
  } finally {
    endMutation();
  }
}

/**
 * Убрать запись из списка на экране. Возвращает функцию возврата на место —
 * ею пользуется `deleteRecord`, если сервер удалять отказался.
 */
export function removeFrom<T>(
  setData: (updater: Updater<T>) => void,
  apply: (prev: T | null) => T | null,
): () => void {
  let previous: T | null = null;
  setData((prev) => {
    previous = prev;
    return apply(prev);
  });
  return () => setData(previous);
}

/**
 * То же для списка, который сейчас не на экране, но лежит в кэше: удаляем
 * ведомость в её карточке — строка должна исчезнуть и в списке ведомостей.
 */
export function removeFromCache<T>(
  url: string,
  apply: (prev: T) => T,
): () => void {
  if (!cache.has(url)) return () => {};
  const previous = cache.get(url) as T;
  cache.set(url, apply(previous));
  return () => cache.set(url, previous);
}

/**
 * Удаление записи — единое правило на весь проект.
 *
 * С экрана запись убирается сразу: ждать сеть, чтобы увидеть результат
 * своего нажатия, человек не должен. А вот НАДПИСЬ «удалено» появляется
 * только после ответа сервера — раньше она показывалась сразу и врала:
 * сервер мог отказать (ведомость уже отправлена, у клиента есть заказы), а
 * человек уже прочитал «удалено» и уходил. Если сервер отказал, запись
 * встаёт на место и видно причину.
 */
export async function deleteRecord(opts: {
  /** убрать запись с экрана; вернуть функцию возврата на случай отказа */
  remove: () => (() => void) | void;
  /** сам запрос удаления */
  request: () => Promise<unknown>;
  /** сообщить об успехе — после подтверждения сервера */
  onDone?: () => void;
  /** сообщить об отказе с причиной от сервера */
  onFail: (message: string) => void;
  /** разделы, которые после удаления надо перечитать */
  refresh?: string[];
}): Promise<boolean> {
  beginMutation();
  const undo = opts.remove();
  try {
    await opts.request();
    endMutation();
    if (opts.refresh?.length) refreshResources(opts.refresh);
    opts.onDone?.();
    return true;
  } catch (e: any) {
    undo?.();
    endMutation();
    opts.onFail(
      e?.response?.data?.message || 'Не удалось удалить. Попробуйте ещё раз',
    );
    return false;
  }
}

/**
 * Сбросить кэш по префиксу адреса — данные подтянутся заново при следующем заходе.
 *
 * Нужно там, где одна операция меняет данные СРАЗУ НЕСКОЛЬКИХ разделов и
 * пересчитать их локально нечем: перевод заказа в «Оплачено» создаёт запись
 * в финансах и меняет аналитику, закрытие смены — начисляет выплаты.
 * Без сброса пользователь увидел бы устаревшие цифры до перезагрузки страницы.
 */
/**
 * Сбросить кэш разделов, зависящих от заказа.
 *
 * У каждой страницы свой кэш: при переходе показывается сохранённое, а свежее
 * подтягивается фоном. Поэтому созданный заказ не появлялся в воронке, выезд
 * по осмотру — в «Сменах», а черновик ведомости — в «Ведомостях», пока не
 * обновишь страницу. После изменения заказа эти разделы надо забыть, чтобы
 * при переходе они загрузились заново.
 */
export function invalidateOrderRelated(): void {
  for (const prefix of [
    '/orders',
    '/clients',
    '/shift-groups',
    '/payroll',
    '/reports',
    '/analytics',
    '/finance',
    '/notifications',
  ]) {
    invalidate(prefix);
  }
}

/*
 * Живой канал изменений.
 *
 * Сервер сообщает, какой раздел данных поменялся, — и все открытые экраны,
 * которые его показывают, обновляются сразу. Опрос по таймеру после этого
 * нужен только как страховка на случай обрыва соединения.
 *
 * Ключ подписки — префикс адреса: экран со списком заказов подписан на
 * «/orders» и реагирует на любое изменение заказов, кем бы оно ни было
 * сделано.
 */
type LiveListener = () => void;
const liveListeners = new Map<string, Set<LiveListener>>();

/** Разделы сервера → префиксы адресов, которые надо перезапросить */
const RESOURCE_URLS: Record<string, string[]> = {
  orders: ['/orders', '/analytics', '/clients'],
  clients: ['/clients', '/orders'],
  tasks: ['/tasks'],
  'shift-groups': ['/shift-groups', '/payroll', '/orders'],
  payroll: ['/payroll', '/finance'],
  finance: ['/finance', '/analytics'],
  reports: ['/reports', '/finance'],
  proposals: ['/proposals'],
  reminders: ['/reminders'],
  checklists: ['/checklists', '/orders'],
  tariffs: ['/tariffs'],
  users: ['/users'],
  cleaners: ['/cleaners', '/brigades'],
  brigades: ['/brigades', '/cleaners'],
  notifications: ['/notifications'],
  trash: ['/trash'],
};

export function subscribeLive(prefix: string, fn: LiveListener): () => void {
  const set = liveListeners.get(prefix) ?? new Set<LiveListener>();
  set.add(fn);
  liveListeners.set(prefix, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) liveListeners.delete(prefix);
  };
}

/** Пришло событие от сервера: чистим кэш и просим экраны перезапроситься */
export function applyLiveChange(resource: string): void {
  for (const prefix of RESOURCE_URLS[resource] ?? ['/' + resource]) {
    invalidate(prefix);
    for (const [key, set] of liveListeners) {
      if (key.startsWith(prefix) || prefix.startsWith(key)) {
        for (const fn of set) fn();
      }
    }
  }
}

/**
 * Забыть кэш указанных разделов и попросить открытые экраны перечитать их.
 *
 * Нужно сразу после изменения данных: пока оно шло, ответы на чтение не
 * принимались (см. readIsStale), поэтому кто-то мог остаться со старым
 * списком. Здесь мы честно догоняем состояние сервера.
 */
export function refreshResources(prefixes: string[]): void {
  for (const prefix of prefixes) {
    invalidate(prefix);
    for (const [key, set] of liveListeners) {
      if (key.startsWith(prefix) || prefix.startsWith(key)) {
        for (const fn of set) fn();
      }
    }
  }
}

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
  // код ответа последней неудачи: 404 значит «повторять бессмысленно»
  const [status, setStatus] = useState(0);

  // при смене URL — мгновенный сброс состояния прямо в рендере,
  // чтобы ни один кадр не показывал данные предыдущего URL
  const [prevUrl, setPrevUrl] = useState(url);
  if (prevUrl !== url) {
    setPrevUrl(url);
    setData(url && cache.has(url) ? (cache.get(url) as T) : null);
    setLoading(!(url && cache.has(url)));
    setError(null);
    setStatus(0);
  }

  // защита от «отставших» ответов: ответ старого URL не должен
  // перезаписать данные нового
  const urlRef = useRef(url);
  urlRef.current = url;

  // что сейчас показано на экране — для решения «принять ли устаревший ответ»
  const dataRef = useRef<T | null>(data);
  dataRef.current = data;

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
      const globalGen = mutationGeneration;
      try {
        const res = await api.get<T>(url);
        // отставший ответ: между стартом запроса и его завершением произошла
        // оптимистичная мутация — не перетираем ни кэш, ни состояние.
        // Проверяем для ЛЮБОЙ загрузки (не только фоновой): первичная
        // тоже может завершиться уже после действия пользователя.
        if (dataGenRef.current !== gen) return;
        /*
         * То же, но про изменения на ДРУГИХ экранах: пока шло удаление,
         * сервер ещё отдавал удаляемую запись. Принять такой ответ значит
         * вернуть её на экран.
         *
         * Отбрасываем его всякий раз, когда человеку есть что показать —
         * из кэша ИЛИ из текущего состояния. Проверка одного лишь кэша
         * оставляла дыру: после удаления кэш стирается (refreshResources),
         * и устаревший ответ, приземлившийся в окно до прихода свежего,
         * проходил защиту насквозь — удалённая ведомость возвращалась на
         * секунду и исчезала снова. Экран при отбрасывании не пустеет:
         * на нём остаётся то, что было, а свежий список уже в пути.
         */
        if (readIsStale(globalGen) && (cache.has(url) || dataRef.current != null)) {
          return;
        }
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
        setStatus(0);
      } catch (e: any) {
        if (urlRef.current !== url) return;
        if (!hasCache && !silent) {
          /*
           * Причина отказа должна быть названа честно.
           *
           * Раньше любая неудача показывала «Проверьте интернет». По
           * уведомлению об удалённом клиенте человек попадал на этот экран
           * и искал неполадки со связью, хотя сервер прямо ответил «не
           * найдено». Различаем: нет записи, сервер упал, связи нет.
           */
          const status = e?.response?.status as number | undefined;
          setStatus(status ?? 0);
          setError(
            status === 404
              ? 'Запись удалена или перемещена в корзину'
              : status === 403
                ? 'Нет доступа к этим данным'
                : status && status >= 500
                  ? 'Сервер не отвечает. Попробуйте ещё раз'
                  : status
                    ? e?.response?.data?.message || 'Не удалось загрузить данные'
                    : 'Нет связи с сервером. Проверьте интернет',
          );
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

  /*
   * Живое обновление: сервер сказал, что раздел поменялся — перезапрашиваем
   * молча. Это и делает интерфейс мгновенным для чужих действий: раньше
   * изменение коллеги ждало следующего тика опроса, до пятнадцати секунд.
   */
  useEffect(() => {
    if (!url) return;
    const prefix = '/' + (url.replace(/^\//, '').split(/[?/]/)[0] ?? '');
    return subscribeLive(prefix, () => {
      if (!pausedRef.current?.()) load(true);
    });
  }, [url, load]);

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

  return {
    data,
    loading,
    error,
    /** Записи нет — повторять запрос бессмысленно, кнопку «Повторить» прячем */
    notFound: status === 404,
    reload,
    setData: updateData,
  };
}
