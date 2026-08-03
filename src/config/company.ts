/**
 * Контактные данные и общая информация о компании.
 * Меняется в одном месте — отражается на всём лендинге.
 */

/** Телефоны компании: первый — основной, он же в шапке */
export const PHONES = [
  { display: '+992 30 388 87 77', href: 'tel:+992303888777' },
  { display: '+992 55 554 00 44', href: 'tel:+992555540044' },
];

export const COMPANY = {
  name: 'Archidea Cleaning',
  city: 'Душанбе',
  tagline: 'Чистота, которой можно доверять',
  phone: PHONES[0].display,
  phoneHref: PHONES[0].href,
  phones: PHONES,
  email: 'info@arhydeya.tj',
  whatsapp: 'https://wa.me/992303888777',
  telegram: 'https://t.me/archideacleaning',
  telegramHandle: '@archideacleaning',
  /** Профиль Instagram */
  instagram: 'https://www.instagram.com/archidea.cleaning/',
  /** Актуальное «Отзывы» — для футера и блока отзывов на лендинге */
  instagramReviews:
    'https://www.instagram.com/stories/highlights/18039382238536790/',
  workingHours: 'Ежедневно с 8:00 до 22:00',
  address: 'г. Душанбе',
};

/** Районы выезда по Душанбе — для блока локальности */
export const DISTRICTS = [
  'Сино',
  'Фирдавси',
  'И. Сомони',
  'Шохмансур',
  'Рудаки',
  'Вахдат',
  'Гиссар',
] as const;
