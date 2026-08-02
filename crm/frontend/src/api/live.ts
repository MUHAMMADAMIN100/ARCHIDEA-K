import { useEffect } from 'react';
import { applyLiveChange } from './hooks';

/**
 * Подключение к живому каналу изменений.
 *
 * Держим одно соединение на вкладку. Сервер присылает короткие сообщения
 * вида {"resource":"orders"} — этого хватает, чтобы обновить нужные
 * экраны. Своё же изменение пропускаем: экран автора уже обновлён
 * оптимистично, и лишний перезапрос сбрасывал бы наполовину заполненную
 * форму.
 *
 * Браузер сам переподключается при обрыве, поэтому своей логики повторов
 * здесь нет — достаточно закрыть соединение при выходе.
 */
export function useLiveUpdates(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events', { withCredentials: true });
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { resource?: string; mine?: boolean };
        if (!msg.resource || msg.mine) return;
        applyLiveChange(msg.resource);
      } catch {
        // мусор в сообщении не должен ронять вкладку
      }
    };
    return () => es.close();
  }, [enabled]);
}
