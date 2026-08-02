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

/** Сообщение о том, что раздел данных изменился */
function handle(
  raw: { resource?: string; actorId?: string; mine?: boolean },
  myId: string | undefined,
): void {
  if (!raw?.resource) return;
  // своё же изменение экран уже показал — перезапрос сбросил бы форму
  if (raw.mine || (raw.actorId && raw.actorId === myId)) return;
  applyLiveChange(raw.resource);
}

/**
 * Живой канал изменений: веб-сокет, а при невозможности — поток событий.
 *
 * Сокет открывается напрямую к серверу приложения, куда кука авторизации
 * не отправляется, поэтому вкладка сначала берёт одноразовый билет обычным
 * запросом и предъявляет его при подключении.
 *
 * Поток событий остаётся запасным путём: если сокет не поднялся за
 * несколько секунд (корпоративный прокси, блокировка), вкладка всё равно
 * получает изменения — на том же /api, где кука работает.
 */
export function useLiveUpdates(enabled: boolean, userId?: string): void {
  useEffect(() => {
    if (!enabled) return;
    let socket: Socket | null = null;
    let es: EventSource | null = null;
    let stopped = false;

    const openStream = () => {
      if (stopped || es || typeof EventSource === 'undefined') return;
      es = new EventSource('/api/events');
      es.onmessage = (e) => {
        try {
          handle(JSON.parse(e.data), userId);
        } catch {
          // мусор в сообщении не должен ронять вкладку
        }
      };
    };

    const openSocket = async () => {
      if (!WS_URL) {
        openStream();
        return;
      }
      try {
        const { ticket } = (
          await api.post<{ ticket: string }>('/auth/ws-ticket')
        ).data;
        if (stopped) return;
        socket = io(WS_URL, {
          path: '/socket',
          auth: { ticket },
          transports: ['websocket', 'polling'],
          withCredentials: true,
          reconnectionDelayMax: 10_000,
        });
        socket.on('changed', (msg) => handle(msg, userId));
        // сокет не поднялся — уходим на поток, чтобы не остаться без обновлений
        socket.on('connect_error', openStream);
      } catch {
        openStream();
      }
    };

    void openSocket();
    // страховка: если сокет молчит, поток подхватит изменения
    const fallback = setTimeout(() => {
      if (!socket?.connected) openStream();
    }, 4000);

    return () => {
      stopped = true;
      clearTimeout(fallback);
      socket?.disconnect();
      es?.close();
    };
  }, [enabled, userId]);
}
