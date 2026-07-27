import { buildOrderText } from './message';
import type { OrderPayload } from '../types';

/**
 * Отправка заявки.
 *
 * Основной канал — Telegram-бот компании (Bot API).
 * Токен и chat_id берутся из переменных окружения (.env):
 *   VITE_TELEGRAM_BOT_TOKEN
 *   VITE_TELEGRAM_CHAT_ID
 *
 * ⚠️ Примечание по безопасности: вызов Bot API напрямую с фронтенда
 * раскрывает токен в браузере. Для продакшена рекомендуется проксировать
 * запрос через серверную функцию (тот самый будущий CRM-бэкенд).
 * Здесь оставлен задел: функция sendToCrm() — точка подключения CRM.
 */

const BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined;
const CHAT_ID = import.meta.env.VITE_TELEGRAM_CHAT_ID as string | undefined;

export interface SubmitResult {
  ok: boolean;
  error?: string;
}

async function sendToTelegram(text: string): Promise<SubmitResult> {
  // Если токен не настроен — не падаем, а логируем (режим демо/разработки).
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn(
      '[Telegram] Токен не настроен. Заявка не отправлена в Telegram.\n' +
        'Добавьте VITE_TELEGRAM_BOT_TOKEN и VITE_TELEGRAM_CHAT_ID в .env\n\n' +
        text,
    );
    // Возвращаем ok:true, чтобы пользователь в демо-режиме видел успех.
    return { ok: true };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text,
          disable_web_page_preview: true,
        }),
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Отправка заявки в CRM «Archidea Sistem».
 *
 * БЕЗОПАСНОСТЬ: браузер обращается к своему же домену (/api/lead), а ключ
 * приёма заявок хранится на сервере (переменные окружения Vercel) и в код
 * страницы не попадает. Раньше ключ лежал прямо в бандле — его мог прочитать
 * любой посетитель и слать поддельные заявки.
 *
 * Локальная разработка: если задан VITE_CRM_API_URL, шлём напрямую
 * (серверных функций у vite dev нет).
 */
/** @returns true — успех, false — ошибка, null — CRM не настроена */
async function sendToCrm(
  order: OrderPayload,
  honeypot: string,
): Promise<boolean | null> {
  const payload = JSON.stringify({ ...order, company: honeypot });

  // dev: прямой вызов бэкенда с локальным ключом
  const devUrl = import.meta.env.VITE_CRM_API_URL as string | undefined;
  const devKey = import.meta.env.VITE_CRM_INTAKE_KEY as string | undefined;
  if (import.meta.env.DEV && devUrl && devKey) {
    try {
      const res = await fetch(`${devUrl}/leads/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': devKey },
        body: payload,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // прод: свой домен, без секретов в браузере
  try {
    const res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    if (res.status === 503) return null; // CRM не подключена на сервере
    return res.ok;
  } catch (e) {
    console.warn('[CRM] Не удалось отправить заявку в CRM:', e);
    return false;
  }
}

/** Пытается доставить заявку по всем настроенным каналам. */
async function trySend(order: OrderPayload, honeypot: string): Promise<boolean> {
  const text = buildOrderText(order);
  const [tg, crm] = await Promise.all([
    sendToTelegram(text),
    sendToCrm(order, honeypot),
  ]);
  const crmOk = crm === null ? true : crm; // не настроена — не считаем ошибкой
  return tg.ok && crmOk;
}

// ── Очередь повторной отправки (чтобы НЕ терять заявки при сбое сети) ──
//
// ВАЖНО ПРО ПЕРСОНАЛЬНЫЕ ДАННЫЕ: в заявке есть имя, телефон и адрес клиента.
// Поэтому очередь живёт в sessionStorage (стирается при закрытии вкладки), а
// не в localStorage — иначе на общем/чужом устройстве данные клиента остались
// бы навсегда. Дополнительно: срок жизни 2 часа и лимит записей.
const QUEUE_KEY = 'arhydeya_pending_orders';
const QUEUE_TTL_MS = 2 * 60 * 60 * 1000;
const QUEUE_MAX = 5;

type QueuedOrder = { order: OrderPayload; honeypot: string; at: number };

/** Хранилище очереди: только на время вкладки */
function store(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function readQueue(): QueuedOrder[] {
  const s = store();
  if (!s) return [];
  try {
    const raw: QueuedOrder[] = JSON.parse(s.getItem(QUEUE_KEY) || '[]');
    const fresh = raw.filter((i) => Date.now() - (i.at ?? 0) < QUEUE_TTL_MS);
    if (fresh.length !== raw.length) writeQueue(fresh);
    return fresh;
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedOrder[]) {
  const s = store();
  if (!s) return;
  try {
    if (q.length === 0) s.removeItem(QUEUE_KEY);
    else s.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
  } catch {
    /* ignore */
  }
}

function saveToQueue(item: Omit<QueuedOrder, 'at'>) {
  writeQueue([...readQueue(), { ...item, at: Date.now() }]);
}

/**
 * Повторная отправка отложенных заявок (вызывается при загрузке страницы).
 * Успешно отправленные удаляются сразу — данные клиента не задерживаются.
 */
export async function flushPendingOrders(): Promise<void> {
  const q = readQueue();
  // на всякий случай подчищаем старое хранилище с ПДн от прежних версий
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
  if (!q.length) return;

  const remaining: QueuedOrder[] = [];
  for (const item of q) {
    try {
      const ok = await trySend(item.order, item.honeypot);
      if (!ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  writeQueue(remaining);
}

/**
 * Оптимистичная отправка: НЕ блокирует интерфейс.
 * Запускается в фоне; при сбое — заявка сохраняется и переотправляется позже.
 */
export function submitOrderOptimistic(order: OrderPayload, honeypot = ''): void {
  trySend(order, honeypot)
    .then((ok) => {
      if (!ok) saveToQueue({ order, honeypot });
    })
    .catch(() => saveToQueue({ order, honeypot }));
}

/**
 * Синхронная отправка (с ожиданием) — оставлена на случай, если понадобится.
 * @param honeypot — скрытое антиспам-поле (должно быть пустым у людей)
 */
export async function submitOrder(
  order: OrderPayload,
  honeypot = '',
): Promise<SubmitResult> {
  const ok = await trySend(order, honeypot);
  return { ok };
}
