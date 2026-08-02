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
     * Не кэшируем.
     *
     * Раньше здесь стояло max-age=60 и stale-while-revalidate=600. Из-за
     * второго Vercel отдавал устаревший ответ ещё десять минут после того,
     * как срок вышел: руководитель скрывал услугу в CRM, а на сайте она
     * оставалась. Проверено на проде — ответ приходил с заголовком
     * x-vercel-cache: STALE и содержал скрытые услуги.
     *
     * Список услуг — управляющая настройка, а не тяжёлые данные: запрос
     * лёгкий, и точность здесь важнее экономии на кэше.
     */
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    console.error('[tariffs] CRM недоступна:', e?.message || e);
    return res.status(502).json({ error: 'unreachable' });
  }
}
