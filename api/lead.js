/**
 * Серверный приём заявки с лендинга (Vercel Function).
 *
 * Зачем: раньше браузер сам ходил в CRM и нёс ключ `x-api-key` в коде
 * страницы — то есть ключ был публичным, его мог прочитать любой и слать
 * фальшивые заявки. Теперь ключ живёт ТОЛЬКО в переменных окружения Vercel,
 * а браузер обращается к своему же домену без каких-либо секретов.
 *
 * Переменные окружения (Environment Variables проекта лендинга):
 *   CRM_API_URL     — например https://<railway>.up.railway.app/api
 *   CRM_INTAKE_KEY  — тот же ключ, что LEADS_INTAKE_API_KEY на бэкенде
 */

/**
 * Разрешаем обращения ТОЛЬКО со своего сайта.
 *
 * Проверка «тот же домен»: host из Origin/Referer должен совпадать с Host,
 * на который пришёл запрос (страница и функция всегда на одном домене). Это
 * не зависит от конкретного адреса (кастомный домен, *.vercel.app, превью) и
 * не ломает реальные заявки. Запрос без Origin/Referer (curl-спам) — отклоняем.
 */
function hostOf(value) {
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).host;
  } catch {
    return null;
  }
}

function originAllowed(req) {
  const source = req.headers.origin || req.headers.referer;
  if (!source) return false; // нет источника — не браузерная форма, отклоняем
  const srcHost = hostOf(source);
  if (!srcHost) return false;

  // тот же домен, что и сам сайт
  if (req.headers.host && srcHost === req.headers.host) return true;

  // плюс явно заданные адреса (кастомный домен/алиасы), если настроены
  const extra = [process.env.LANDING_URL, process.env.VERCEL_URL]
    .filter(Boolean)
    .map(hostOf)
    .filter(Boolean);
  return extra.includes(srcHost);
}

/** IP посетителя (Vercel кладёт реальный адрес в x-forwarded-for) */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (raw ? raw.split(',')[0].trim() : '') || req.socket?.remoteAddress || 'unknown';
}

/**
 * Лёгкий лимит по IP (best-effort, в памяти тёплого инстанса): не более
 * WINDOW_MAX заявок за WINDOW_MS. Основной барьер — лимит на самом бэкенде,
 * это дополнительный рубеж от простого спама.
 */
const WINDOW_MS = 10 * 60 * 1000;
const WINDOW_MAX = 4;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 2000) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
    }
  }
  return arr.length > WINDOW_MAX;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  if (rateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const apiUrl = process.env.CRM_API_URL;
  const apiKey = process.env.CRM_INTAKE_KEY;
  if (!apiUrl || !apiKey) {
    /*
     * CRM не подключена — принять заявку НЕКУДА. Другого канала у сайта нет:
     * отправка в Telegram из браузера убрана вместе с токеном бота.
     *
     * Поэтому 503 здесь — не «мелкая неполадка», а потерянный заказ. Сайт
     * покажет человеку экран «позвоните нам», но переменные CRM_API_URL и
     * CRM_INTAKE_KEY обязаны быть заданы в окружении Vercel.
     */
    console.error(
      '[lead] ЗАЯВКА НЕ ПРИНЯТА: не заданы CRM_API_URL и/или CRM_INTAKE_KEY',
    );
    return res.status(503).json({ error: 'CRM is not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const upstream = await fetch(`${apiUrl}/leads/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body ?? {}),
    });
    /*
     * Наружу не отдаём подробности бэкенда, но код ответа обязательно пишем в
     * лог: без него «заявка не дошла» неотличимо от «CRM ответила отказом», и
     * потерю заявок можно заметить только вручную, сверяя сайт с воронкой.
     */
    if (!upstream.ok) {
      console.error(
        `[lead] CRM отклонила заявку: ${upstream.status} ${upstream.statusText}`,
      );
    }
    // reason нужен поддержке, чтобы отличить неверный ключ от недоступной CRM
    return res
      .status(upstream.ok ? 200 : 502)
      .json(
        upstream.ok
          ? { ok: true }
          : { ok: false, reason: `upstream_${upstream.status}` },
      );
  } catch (e) {
    console.error('[lead] CRM недоступна:', e?.message || e);
    return res.status(502).json({ ok: false, reason: 'unreachable' });
  }
}
