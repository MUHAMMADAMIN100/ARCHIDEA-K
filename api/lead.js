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
 * Разрешаем обращения ТОЛЬКО со своего сайта. В отличие от прежней версии,
 * запрос без Origin/Referer отклоняется: браузер со страницы лендинга всегда
 * шлёт хотя бы Referer, а «голый» POST (curl-спам) — нет.
 */
function originAllowed(req) {
  const source = req.headers.origin || req.headers.referer;
  if (!source) return false; // нет источника — не браузерная форма, отклоняем
  const allowed = [process.env.LANDING_URL, process.env.VERCEL_URL]
    .filter(Boolean)
    .map((h) => (h.startsWith('http') ? h : `https://${h}`));
  // подстраховка на превью-деплоях, где переменные не заданы
  if (allowed.length === 0) allowed.push('https://cleaning-khaki-kappa.vercel.app');
  try {
    const origin = new URL(source).origin;
    return allowed.some((a) => {
      try {
        return new URL(a).origin === origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
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
    // CRM не подключена — заявка всё равно уходит в Telegram на фронте
    return res.status(503).json({ error: 'CRM is not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const upstream = await fetch(`${apiUrl}/leads/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body ?? {}),
    });
    // наружу отдаём только факт успеха — без деталей бэкенда
    return res.status(upstream.ok ? 200 : 502).json({ ok: upstream.ok });
  } catch {
    return res.status(502).json({ ok: false });
  }
}
