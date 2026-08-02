let counter = 0;

/** Временный id для оптимистично созданных элементов (до ответа сервера) */
export function tempId(): string {
  counter += 1;
  return `temp_${counter}`;
}

/**
 * Запись ещё не сохранена на сервере: показана оптимистично и живёт под
 * временным номером. Открывать её карточку нельзя — сервер такого номера
 * не знает и ответит ошибкой.
 */
export function isTempId(id: string): boolean {
  return id.startsWith('temp_');
}

/** Текущая дата в ISO (для оптимистичных элементов) */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Повтор запроса при разовом сбое (холодный старт / кратковременный 502).
 * Повторяем ТОЛЬКО сетевые сбои и 5xx — ответы 4xx детерминированы
 * (повтор не поможет). Важно для неидемпотентного DELETE: если первый
 * запрос на самом деле удалил запись, а ответ потерялся, мы НЕ шлём
 * повтор (который вернул бы 404), а сразу отдаём исходную ошибку.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 1,
  delayMs = 800,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const status = (e as any)?.response?.status as number | undefined;
    // 4xx (кроме 408/429) — окончательный ответ, не повторяем
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      throw e;
    }
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return withRetry(fn, retries - 1, delayMs);
    }
    throw e;
  }
}
