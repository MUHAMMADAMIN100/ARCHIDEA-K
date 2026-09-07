import { useCallback } from 'react';
import { useToast } from '../components/Toast';
import { withRetry } from './util';

export interface BackgroundSaveOptions {
  /** Сам запрос сохранения. Повторяется при обрыве сети или 5xx */
  request: () => Promise<unknown>;
  /** Что сказать, если сервер не объяснил причину сам */
  failMessage?: string;
  /** После подтверждения сервера */
  onDone?: () => void;
  /** После окончательного отказа — обычно вернуть серверное состояние */
  onFail?: (message: string) => void;
  /**
   * Сколько раз повторять самим при обрыве сети / 5xx. По умолчанию 2 — для
   * правок это безопасно: форма шлёт состояние целиком. Для СОЗДАНИЯ записи
   * (POST) ставьте 0: ответ мог потеряться уже после того, как сервер запись
   * создал, и автоповтор завёл бы вторую. Кнопка «Повторить» остаётся —
   * решает человек, который видит список.
   */
  retries?: number;
}

/**
 * Сохранение в фоне — единое правило для всех форм.
 *
 * Окно закрывается сразу (решение владельца: ждать сеть незачем), а запрос
 * уходит фоном — но так, чтобы правка НЕ потерялась молча:
 *
 *  - обрыв сети и 5xx повторяются сами (два раза, с паузой); повтор
 *    безопасен — форма шлёт состояние целиком, и второй такой же запрос
 *    ничего не дублирует;
 *  - окончательный отказ показывается красной плашкой, которая НЕ исчезает
 *    сама, с кнопкой «Повторить» — тот же запрос уходит ещё раз;
 *  - отказ сервера по существу (400: «укажите причину отказа») показывается
 *    так же, но без «Повторить»: повтор того же не поможет.
 *
 * Раньше каждая форма делала это по-своему: одна ждала, другая закрывалась
 * и молчала, третья показывала всплывашку на три секунды — человек уходил
 * с экрана и не знал, что команда на заказе так и не сохранилась.
 */
export function useBackgroundSave() {
  const toast = useToast();

  const run = useCallback(
    async function attempt(opts: BackgroundSaveOptions): Promise<boolean> {
      try {
        await withRetry(opts.request, opts.retries ?? 2, 1000);
        opts.onDone?.();
        return true;
      } catch (e: any) {
        const status = e?.response?.status as number | undefined;
        const message =
          e?.response?.data?.message ||
          opts.failMessage ||
          'Не удалось сохранить';
        const text = Array.isArray(message) ? message.join('; ') : String(message);
        opts.onFail?.(text);
        // 4xx — окончательный ответ сервера, повтор не поможет
        const retryable =
          !status || status >= 500 || status === 408 || status === 429;
        toast.error(text, {
          sticky: true,
          action: retryable
            ? { label: 'Повторить', onClick: () => void attempt(opts) }
            : undefined,
        });
        return false;
      }
    },
    [toast],
  );

  return run;
}
