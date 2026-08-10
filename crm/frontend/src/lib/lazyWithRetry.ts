import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { reloadForFreshChunks } from './chunkReload';
import { ChunkFallback } from '../components/ChunkFallback';

/**
 * lazy() с устойчивой загрузкой чанка на мобильном/флаки-сети:
 * - повтор импорта один раз при сбое;
 * - если чанк всё ещё не грузится (частая причина — новый деплой заменил
 *   имена файлов, а у пользователя открыта старая версия) — один раз
 *   перезагружаем страницу, чтобы получить свежий index.html и чанки.
 * Общий guard (chunkReload.ts) не даёт зациклить перезагрузку.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch {
      // вторая попытка через короткую паузу
      try {
        await new Promise((r) => setTimeout(r, 600));
        return await factory();
      } catch {
        reloadForFreshChunks();
        // Если перезагрузка не сработала (сработала защита от зацикливания),
        // показываем понятный экран с кнопкой «Обновить». Пустоту не рисуем
        // никогда: белый экран рядом с работающим меню человек читает как
        // «система сломалась», и починить его сам он не может.
        return { default: ChunkFallback as unknown as T };
      }
    }
  });
}
