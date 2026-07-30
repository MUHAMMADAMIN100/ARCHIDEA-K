/**
 * Актуальные услуги и цены для калькулятора сайта (Vercel Function).
 *
 * Зачем прокси, если эндпоинт CRM и так публичный: браузеру нужен адрес CRM,
 * а он приходил только через переменную сборки VITE_CRM_API_URL. Если её не
 * задать (или задать после сборки), сайт молча оставался на резервных ценах —
 * новые услуги на нём не появлялись вовсе. Здесь адрес берётся из окружения
 * сервера — того же, что уже настроено для приёма заявок.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiUrl = process.env.CRM_API_URL;
  if (!apiUrl) {
    // CRM не подключена — сайт останется на резервных ценах из конфигурации
    return res.status(503).json({ error: 'CRM is not configured' });
  }

  try {
    const upstream = await fetch(`${apiUrl}/tariffs`);
    if (!upstream.ok) {
      console.error(`[tariffs] CRM ответила ${upstream.status}`);
      return res.status(502).json({ error: 'upstream', code: upstream.status });
    }
    const data = await upstream.json();
    /*
     * Кэш на минуту: цены меняются редко, а калькулятор открывают часто.
     * stale-while-revalidate отдаёт старое значение мгновенно и обновляет фоном.
     */
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=600',
    );
    return res.status(200).json(data);
  } catch (e) {
    console.error('[tariffs] CRM недоступна:', e?.message || e);
    return res.status(502).json({ error: 'unreachable' });
  }
}
