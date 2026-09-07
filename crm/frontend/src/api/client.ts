import axios from 'axios';

/**
 * В проде обращаемся к API через СВОЙ домен (/api проксируется на Railway
 * через vercel.json). Тогда для браузера это один сайт (first-party) и
 * cookie-авторизация работает везде, включая iOS Safari и встроенные
 * браузеры (Telegram/Instagram), где межсайтовые cookie блокируются ITP.
 * Локально — прямой адрес из VITE_API_URL.
 */
const isLocalhost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
const baseURL = isLocalhost
  ? import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
  : '/api';

/**
 * Авторизация — только через httpOnly-cookie (withCredentials).
 * Токен НЕ хранится в JS/localStorage → недоступен для XSS.
 *
 * timeout: на мобильном/флаки-сети запрос без таймаута может висеть вечно
 * (отсюда «бесконечный спиннер»). 15 сек — верхняя граница на попытку.
 */
export const api = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 15000,
});

/**
 * Сохранения ждут дольше, чем чтение.
 *
 * 15 секунд — потолок для запроса за данными: дальше быстрее показать
 * ошибку. Но сохранение карточки заказа — это транзакция с пересчётом,
 * выездами и журналом; на бою она занимает 3–6 секунд, а на телефонном
 * интернете легко вдвое больше. Обрывать её на 15-й секунде значит терять
 * правку, которую сервер, возможно, уже применил. Даём сохранениям 45 секунд.
 */
export const MUTATION_TIMEOUT_MS = 45_000;
api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get' && config.timeout === api.defaults.timeout) {
    config.timeout = MUTATION_TIMEOUT_MS;
  }
  return config;
});

/**
 * Мягкий авто-повтор для ЧТЕНИЯ (GET): обрыв сети или 5xx — типичная
 * ситуация на мобильном интернете. До 2 повторов с нарастающей паузой.
 * НЕ повторяем: мутации (POST/PATCH/DELETE — неидемпотентны), 4xx
 * (в т.ч. 401 — чтобы AuthContext увидел разлогин) и ТАЙМАУТЫ
 * (повтор timeout лишь удвоил бы ожидание — быстрее показать ошибку).
 */
api.interceptors.response.use(undefined, async (error) => {
  const cfg = error?.config;
  const method = (cfg?.method || 'get').toLowerCase();
  const status = error?.response?.status as number | undefined;
  const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
  const isNetworkDrop = !error.response && !isTimeout; // обрыв соединения
  const isRetriableStatus = status === 502 || status === 503 || status === 504;

  if (cfg && method === 'get' && (isNetworkDrop || isRetriableStatus)) {
    cfg.__retryCount = cfg.__retryCount ?? 0;
    if (cfg.__retryCount < 2) {
      cfg.__retryCount += 1;
      await new Promise((r) => setTimeout(r, 600 * cfg.__retryCount));
      return api(cfg);
    }
  }
  return Promise.reject(error);
});

// Чистим возможный старый небезопасный токен из прошлых версий
try {
  localStorage.removeItem('archidea_token');
} catch {
  /* ignore */
}
