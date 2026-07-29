/**
 * Печать документа в PDF средствами браузера (ТЗ 9).
 *
 * Своей генерации PDF намеренно нет: подключать библиотеку ради КП — это
 * плюс сотни килобайт к бандлу и отдельная возня со шрифтами для кириллицы.
 * Диалог печати браузера умеет «Сохранить как PDF», шрифты берёт системные,
 * и результат сразу можно отправить клиенту файлом.
 *
 * Имя файла берётся из заголовка вкладки, поэтому на время печати подменяем
 * document.title и возвращаем обратно.
 */
export function printDocument(fileName?: string): void {
  if (typeof window === 'undefined') return;

  const original = document.title;
  if (fileName) {
    // в имени файла запрещённые символы заменяем, иначе браузер их срежет сам
    document.title = fileName.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  }

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = original;
    window.removeEventListener('afterprint', restore);
  };

  window.addEventListener('afterprint', restore);
  // Safari не всегда вызывает afterprint — подстраховываемся таймером
  window.setTimeout(restore, 60_000);

  window.print();
}
