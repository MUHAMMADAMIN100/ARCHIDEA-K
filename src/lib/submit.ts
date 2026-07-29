import type { OrderPayload } from '../types';

/**
 * Отправка заявки с сайта.
 *
 * Единственный канал — собственный серверный обработчик /api/lead, который
 * передаёт заявку в CRM. Уведомление в Telegram компании уходит уже оттуда,
 * с сервера.
 *
 * Раньше браузер сам дёргал Telegram Bot API, и токен бота вкомпилировался
 * в публичный бандл: его мог прочитать любой посетитель сайта и через getUpdates
 * читать все заявки — с именами, телефонами и адресами клиентов, — а через
 * setWebhook увести поток заявок себе. Теперь ни токена, ни ключей
 * в коде страницы нет вообще.
 */

export interface SubmitResult {
  ok: boolean;
  error?: string;
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

/**
 * Пытается доставить заявку.
 * null означает «CRM не подключена на сервере» — в этом случае считать заявку
 * потерянной нельзя, но и доставленной тоже: кладём её в очередь на повтор.
 */
async function trySend(order: OrderPayload, honeypot: string): Promise<boolean> {
  const crm = await sendToCrm(order, honeypot);
  return crm === true;
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
