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
/**
 * Итог одной попытки: отправлено, отказ по существу или сбой связи.
 * «rejected» повторять бессмысленно — сервер ответил и объяснил, что не так.
 */
type SendResult = true | false | 'rejected' | null;

/**
 * Последняя причина отказа от сервера — её показывает экран «не удалось».
 * Без неё человек видел «связь прервалась» даже тогда, когда не заполнил
 * адрес: подсказать, что именно поправить, было нечем.
 */
let lastMessage: string | null = null;

export function lastSubmitMessage(): string | null {
  return lastMessage;
}

async function sendToCrm(
  order: OrderPayload,
  honeypot: string,
): Promise<SendResult> {
  /*
   * Пустой запасной номер не отправляем.
   *
   * В поле с самого начала стоит код страны: если посетитель его не трогал,
   * на сервер уходила эта строка, проверка браковала её — и заявка целиком
   * получала отказ, хотя запасной номер необязателен.
   *
   * Считаем поле пустым, когда в нём меньше семи цифр: короче не бывает ни
   * одного международного номера, а код страны сам по себе — не телефон.
   */
  const extraDigits = (order.contact?.phone2 ?? '').replace(/\D/g, '');
  const hasExtra = extraDigits.length >= 7;
  const contact = hasExtra
    ? order.contact
    : { ...order.contact, phone2: undefined };
  const payload = JSON.stringify({ ...order, contact, company: honeypot });

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
    if (res.ok) return true;
    /*
     * Отказ по существу: проверка полей (400) или слишком частая отправка
     * (429). Сервер ответил и объяснил причину — повторять нечего.
     * Всё остальное (502, 504, обрыв) — временная неполадка, повторим.
     */
    let text: string | null = null;
    try {
      const body = await res.json();
      const raw = body?.message;
      text = typeof raw === 'string' ? raw : null;
      /*
       * «Слишком частые заявки» — это НЕ отказ. Сервер защищается от двойной
       * отправки одного и того же обращения: первая заявка уже принята, и
       * пугать человека экраном «связь прервалась» нельзя — он решит, что
       * заказа нет, и уйдёт.
       */
      if (text && /част/i.test(text)) return true;
      if (typeof body?.reason === 'string' && body.reason.startsWith('upstream_4')) {
        lastMessage = text;
        return 'rejected';
      }
    } catch {
      /* тело не разобрать — считаем сбоем связи и повторим */
    }
    if (res.status === 400 || res.status === 403) {
      lastMessage = text;
      return 'rejected';
    }
    if (res.status === 429) return true; // тот же случай: заявка уже ушла
    return false;
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
/** Пауза между попытками отправки */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Отправка с повтором.
 *
 * Сервер иногда недоступен считанные секунды — например, пока выкатывается
 * обновление. Одной неудачной попытки хватало, чтобы человек увидел «Не
 * удалось отправить заявку» и ушёл, хотя через три секунды всё работало.
 * Поэтому пробуем трижды с нарастающей паузой и только потом сдаёмся;
 * заявка при этом всё равно остаётся в очереди и уйдёт при следующем
 * открытии страницы.
 *
 * Повторяем ТОЛЬКО отказ по связи или сбой сервера. Если сервер сказал
 * «заполните адрес» или «слишком частые заявки», повтор ничего не изменит.
 */
async function trySend(order: OrderPayload, honeypot: string): Promise<boolean> {
  const delays = [0, 2500, 6000];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await sleep(delays[attempt]);
    const crm = await sendToCrm(order, honeypot);
    if (crm === true) return true;
    // отказ по существу (проверка полей, лимит) — повторять бессмысленно
    if (crm === 'rejected') return false;
  }
  return false;
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
 * Убрать заявку из очереди — она уже ушла фоновой попыткой.
 * Сравниваем по телефону: одна и та же заявка второй раз в очередь не
 * попадает, а держать данные клиента дольше нужного нельзя.
 */
function dropFromQueue(order: OrderPayload) {
  const phone = order.contact?.phone;
  if (!phone) return;
  writeQueue(readQueue().filter((i) => i.order.contact?.phone !== phone));
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
 *
 * onResult обязателен по смыслу, даже если формально необязателен: без него
 * человеку показывали «Заявка отправлена» независимо от того, дошла она или
 * нет. Если на сервере не заданы переменные CRM, каждая заявка отвечала 503,
 * ложилась в очередь и переотправлялась по тому же нерабочему адресу — то
 * есть терялась молча, а клиент был уверен, что ему перезвонят.
 */
export function submitOrderOptimistic(
  order: OrderPayload,
  honeypot = '',
  onResult?: (ok: boolean) => void,
): void {
  trySend(order, honeypot)
    .then((ok) => {
      if (ok) {
        onResult?.(true);
        return;
      }
      saveToQueue({ order, honeypot });
      onResult?.(false);
      void keepTrying(order, honeypot, onResult);
    })
    .catch(() => {
      saveToQueue({ order, honeypot });
      onResult?.(false);
      void keepTrying(order, honeypot, onResult);
    });
}

/**
 * Тихие попытки после того, как экран уже показал «не удалось».
 *
 * Сервер бывает недоступен около минуты — например, пока выкатывается
 * обновление, — а три быстрые попытки укладываются в десять секунд. Дальше
 * пробуем в фоне: человек в это время читает телефон и часы работы, а если
 * заявка всё-таки уходит, экран сам сменяется на «Заявка отправлена».
 *
 * Причина отказа по существу (не заполнено поле) сюда не попадает: там
 * повторять нечего, и trySend возвращает результат сразу.
 */
async function keepTrying(
  order: OrderPayload,
  honeypot: string,
  onResult?: (ok: boolean) => void,
): Promise<void> {
  if (lastMessage) return; // сервер объяснил причину — повтор не поможет
  const delays = [15_000, 30_000, 60_000, 120_000];
  for (const wait of delays) {
    await sleep(wait);
    const res = await sendToCrm(order, honeypot);
    if (res === true) {
      dropFromQueue(order);
      onResult?.(true);
      return;
    }
    if (res === 'rejected') return;
  }
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
