/**
 * Разовые сотрудники заказа — кого позвали на один раз.
 *
 * В базе лежат JSON-массивом (Order.guestCleaners), потому что в штат такие
 * люди не заводятся: у них нет карточки клинера, ставки и истории смен —
 * только имя и сумма, отданная за этот выезд.
 *
 * Читать их напрямую нельзя: JSON приходит как `unknown`, старые заказы
 * держат там `null`, а руками в него могли записать что угодно. Эта функция —
 * единственное место, где сырой JSON превращается в понятные строки, и она
 * молча выбрасывает мусор: строку без имени в ведомость ставить нельзя.
 */
export interface OrderGuest {
  fullName: string;
  rate: number;
}

export function guestsOf(raw: unknown): OrderGuest[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = (row ?? {}) as { fullName?: unknown; rate?: unknown };
      return {
        fullName: String(item.fullName ?? '').trim(),
        rate: Math.max(0, Math.round(Number(item.rate) || 0)),
      };
    })
    .filter((g) => g.fullName.length > 0);
}
