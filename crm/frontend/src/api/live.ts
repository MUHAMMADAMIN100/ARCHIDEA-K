import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from './client';
import { applyLiveChange } from './hooks';

/**
 * Адрес сервера приложения для сокета.
 *
 * Обычные запросы идут через свой домен: адрес /api переписывается на
 * сервер приложения. Сокет так не умеет — соединение поднимается напрямую,
 * поэтому адрес задаётся при сборке (VITE_WS_URL). Если он не задан,
 * работаем по потоку событий: он идёт через тот же /api и настройки не
 * требует.
 */
const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ||
  /*
   * На проде адрес известен и без настройки — сокет идёт напрямую к серверу
   * приложения. На localhost по умолчанию не подключаемся: там работает
   * поток событий через прокси разработки, и лезть на прод из локальной
   * сборки не нужно.
   */
  (typeof location !== 'undefined' && location.hostname.endsWith('.vercel.app')
    ? 'https://archidea-k-production.up.railway.app'
    : undefined);

/** Сколько номеров событий помним, чтобы отличить повтор от нового */
const SEEN_LIMIT = 200;
/** Молчание потока дольше этого — считаем оборванным (пульс идёт раз в 20 с) */
const STREAM_SILENCE_MS = 45_000;
/** Как часто сторож проверяет оба канала */
const WATCH_MS = 10_000;

interface Incoming {
  id?: number;
  resource?: string;
  actorId?: string;
  mine?: boolean;
  ping?: number;
}

/**
 * Живой канал изменений: веб-сокет И поток событий одновременно.
 *
 * Почему оба сразу, а не «сокет, а если не вышло — поток». Раньше поток
 * поднимался только через четыре секунды после неудачи сокета, а молчащий
 * сокет неудачей не считался вовсе: соединение висело «подключённым», но
 * посредник давно его оборвал — и вкладка сидела без изменений, пока не
 * срабатывал опрос по таймеру. Отсюда и брались задержки в десятки секунд.
 *
 * Пути разные по природе: сокет идёт напрямую к серверу приложения, поток —
 * через свой домен вместе с остальными запросами. Что-нибудь одно да
 * работает при любой сети и любом посреднике. Одно и то же изменение
 * приходит по обоим, поэтому у события есть номер: второе сообщение с тем
 * же номером отбрасывается, лишнего запроса за данными не будет.
 *
 * Сторож следит за обоими: поток молчит дольше сорока пяти секунд (пульс
 * идёт каждые двадцать) — пересобираем его; сокет не подключён —
 * запрашиваем новый билет и поднимаем заново.
 */
export function useLiveUpdates(enabled: boolean, userId?: string): void {
  useEffect(() => {
    if (!enabled) return;

    let socket: Socket | null = null;
    let es: EventSource | null = null;
    let stopped = false;
    let streamSeen = Date.now();
    let socketBusy = false;
    let socketTried = 0;

    // номера уже применённых событий — защита от двойного прихода
    const seen = new Set<number>();
    const order: number[] = [];

    const apply = (raw: Incoming, fromStream: boolean): void => {
      if (fromStream) streamSeen = Date.now();
      if (!raw || raw.ping) return; // пульс: канал жив, менять нечего
      if (!raw.resource) return;
      if (typeof raw.id === 'number') {
        if (seen.has(raw.id)) return; // это же событие пришло по второму каналу
        seen.add(raw.id);
        order.push(raw.id);
        if (order.length > SEEN_LIMIT) {
          const old = order.shift();
          if (old !== undefined) seen.delete(old);
        }
      }
      // своё же изменение экран уже показал — перезапрос сбросил бы форму
      if (raw.mine || (raw.actorId && raw.actorId === userId)) return;
      applyLiveChange(raw.resource);
    };

    const closeStream = (): void => {
      es?.close();
      es = null;
    };

    const openStream = (): void => {
      if (stopped || es || typeof EventSource === 'undefined') return;
      streamSeen = Date.now();
      es = new EventSource('/api/events');
      es.onmessage = (e) => {
        try {
          apply(JSON.parse(e.data) as Incoming, true);
        } catch {
          // мусор в сообщении не должен ронять вкладку
        }
      };
      /*
       * Ошибку не глушим переоткрытием руками: EventSource переподключается
       * сам. Отмечаем время, чтобы сторож не счёл канал мёртвым, пока идёт
       * его собственная попытка.
       */
      es.onerror = () => {
        streamSeen = Date.now();
      };
    };

    const openSocket = async (): Promise<void> => {
      if (stopped || !WS_URL || socketBusy || socket?.connected) return;
      /*
       * Не чаще раза в полминуты: пока сокет лежит, сам socket.io уже
       * переподключается по своему расписанию, и просить новый билет каждые
       * десять секунд значило бы стучаться в сервер впустую.
       */
      if (Date.now() - socketTried < 30_000) return;
      socketTried = Date.now();
      socketBusy = true;
      try {
        const { ticket } = (
          await api.post<{ ticket: string }>('/auth/ws-ticket')
        ).data;
        if (stopped) return;
        socket?.disconnect();
        socket = io(WS_URL, {
          path: '/socket',
          auth: { ticket },
          transports: ['websocket', 'polling'],
          withCredentials: true,
          reconnectionDelayMax: 5_000,
        });
        socket.on('changed', (msg: Incoming) => apply(msg, false));
      } catch {
        // билет не выдали (сеть, разлогин) — поток событий уже работает
      } finally {
        socketBusy = false;
      }
    };

    openStream();
    void openSocket();

    const check = (): void => {
      if (stopped || document.hidden) return;
      if (Date.now() - streamSeen > STREAM_SILENCE_MS) {
        closeStream();
        openStream();
      }
      if (!socket?.connected) void openSocket();
    };

    const watch = setInterval(check, WATCH_MS);
    /*
     * Возврат на вкладку и восстановление сети — самые частые моменты, когда
     * канал оказывается оборванным: телефон спал, ноутбук закрывали. Проверяем
     * сразу, не дожидаясь очередного круга сторожа.
     */
    const onWake = (): void => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);

    return () => {
      stopped = true;
      clearInterval(watch);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
      socket?.disconnect();
      closeStream();
    };
  }, [enabled, userId]);
}
