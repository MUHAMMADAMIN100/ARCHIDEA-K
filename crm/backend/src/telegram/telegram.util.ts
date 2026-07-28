/**
 * Экранирование значений, подставляемых в сообщения Telegram (parse_mode=HTML).
 *
 * Бот шлёт сообщения с разметкой `<b>…</b>`, поэтому имя клиента вроде
 * `Иванов <Строй>` или заметка со знаком `&` ломает разметку и обрывает
 * сообщение — экранируем спецсимволы перед подстановкой.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
