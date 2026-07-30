/**
 * Ключ услуги генерируется из названия, а не вводится руками.
 *
 * Ключ нужен системе: по нему заказ связан с услугой, а калькулятор сайта
 * понимает, что считать. Но человеку он не нужен и только мешал: пока поле
 * пустое, кнопка «Сохранить» была заблокирована — менеджер заполнял цены,
 * нажимал сохранить и решал, что цены не сохраняются.
 */

const TRANSLIT: Record<string, string> = {
  а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'ZH',
  з: 'Z', и: 'I', й: 'Y', к: 'K', л: 'L', м: 'M', н: 'N', о: 'O',
  п: 'P', р: 'R', с: 'S', т: 'T', у: 'U', ф: 'F', х: 'H', ц: 'TS',
  ч: 'CH', ш: 'SH', щ: 'SCH', ъ: '', ы: 'Y', ь: '', э: 'E', ю: 'YU',
  я: 'YA',
};

/** «Мытьё окон под ключ» → «MYTYO_OKON_POD_KLYUCH» */
export function slugFromTitle(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => {
      if (TRANSLIT[ch] !== undefined) return TRANSLIT[ch];
      if (/[a-z0-9]/.test(ch)) return ch.toUpperCase();
      return ' ';
    })
    .join('')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 34);

  // ключ обязан начинаться с латинской буквы — требование формата
  return /^[A-Z]/.test(base) ? base : `SERVICE_${base}`.slice(0, 40);
}

/**
 * Свободный ключ: если такой уже занят (в том числе лежит в корзине),
 * добавляем номер. Занятый ключ иначе выдавал бы конфликт на сохранении.
 */
export async function uniqueKey(
  base: string,
  exists: (key: string) => Promise<boolean>,
): Promise<string> {
  const root = base || 'SERVICE';
  if (!(await exists(root))) return root;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${root.slice(0, 36)}_${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  // крайний случай: добавляем метку времени, чтобы сохранение не падало
  return `${root.slice(0, 30)}_${Date.now().toString(36).toUpperCase()}`;
}
