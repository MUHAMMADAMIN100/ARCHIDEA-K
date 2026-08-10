import { reloadNow } from '../lib/chunkReload';

/**
 * Показывается вместо раздела, если его код так и не догрузился.
 *
 * Раньше в этом случае рисовалась пустота: меню слева на месте, а справа
 * белый экран — человек не понимал, сломалось что-то или он не туда нажал.
 * Теперь видно, что произошло, и есть кнопка, которая это чинит.
 */
export function ChunkFallback() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-lg font-semibold text-navy-900">
        Раздел не загрузился
      </div>
      <div className="max-w-xs text-sm text-navy-600">
        Обычно это старая версия страницы в браузере или обрыв связи. Нажмите
        «Обновить» — раздел загрузится заново.
      </div>
      <button onClick={reloadNow} className="btn-primary">
        Обновить
      </button>
    </div>
  );
}
