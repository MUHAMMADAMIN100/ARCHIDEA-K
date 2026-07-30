/**
 * ============================================================
 *  КОНФИГУРАЦИЯ ЦЕН «Archidea Cleaning»
 * ============================================================
 *  Здесь — резервные (стартовые) цены. Актуальные цены сайт
 *  автоматически подтягивает из CRM (см. lib/tariffs.ts):
 *  руководитель меняет тариф в CRM → цена обновляется на сайте.
 *  Валюта — сомони (TJS).
 * ============================================================
 */

export const CURRENCY = 'сомони';

/** Степень загрязнения — влияет на цену за м² */
export type DirtLevel = 'light' | 'medium' | 'heavy';

export const DIRT_LEVELS: { id: DirtLevel; title: string; hint: string }[] = [
  { id: 'light', title: 'Лёгкая', hint: 'регулярно убираетесь' },
  { id: 'medium', title: 'Средняя', hint: 'давно не было уборки' },
  { id: 'heavy', title: 'Тяжёлая', hint: 'сильные загрязнения' },
];

/** Услуга: уборка по м² (3 цены по степени) или мебель (цена за место) */
export interface CleaningType {
  /*
   * Идентификатор — произвольная строка, а не тройка литералов: директор
   * заводит новые услуги в CRM, и сайт обязан их показывать. Раньше тип
   * допускал только три значения, поэтому новая услуга не могла тут появиться.
   */
  id: string;
  title: string;
  /** Цены по степени загрязнения (для мебели все три равны) */
  prices: Record<DirtLevel, number>;
  /** true — цена за посадочное место (мягкая мебель), не за м² */
  perSeat?: boolean;
  description: string;
  popular?: boolean;
}

export const CLEANING_TYPES: CleaningType[] = [
  {
    id: 'general',
    title: 'Генеральная',
    prices: { light: 25, medium: 27, heavy: 29 },
    description:
      'Основательная уборка всей заявленной площади — абсолютная чистота даже в самых труднодоступных местах.',
    popular: true,
  },
  {
    id: 'post_renovation',
    title: 'После ремонта',
    prices: { light: 30, medium: 32, heavy: 35 },
    description:
      'Уборка от строительного мусора и послестроительных остатков, подготовка помещения к жизни.',
  },
  {
    id: 'furniture',
    title: 'Мойка мягкой мебели',
    prices: { light: 70, medium: 70, heavy: 70 },
    perSeat: true,
    description:
      'Чистка мягкой мебели от пятен, устранение запахов и возвращение первозданного вида.',
  },
];

/** Дополнительная услуга с фиксированной ценой */
export interface ExtraService {
  /* Как и у услуги: произвольный ключ из CRM, а не фиксированный набор */
  id: string;
  title: string;
  /** Цена за единицу */
  price: number;
  /** true — можно указать количество (шт.), false — разовая опция */
  hasQuantity: boolean;
  unit?: string;
  hint?: string;
}

export const EXTRA_SERVICES: ExtraService[] = [
  {
    id: 'windows',
    title: 'Мытьё окон',
    price: 50,
    hasQuantity: true,
    unit: 'шт',
    hint: 'Цена за одно окно (с двух сторон)',
  },
  {
    id: 'fridge',
    title: 'Мытьё холодильника внутри',
    price: 80,
    hasQuantity: false,
  },
  {
    id: 'oven',
    title: 'Чистка духовки',
    price: 70,
    hasQuantity: false,
  },
  {
    id: 'ironing',
    title: 'Глажка белья (1 час)',
    price: 90,
    hasQuantity: false,
  },
];

/** Минимальная стоимость заказа (защита от слишком маленькой суммы) */
export const MIN_ORDER_PRICE = 150;

/** Значения по умолчанию для калькулятора */
export const DEFAULTS = {
  area: 50,
  cleaningTypeId: 'general' as CleaningType['id'],
  dirtLevel: 'light' as DirtLevel,
  seats: 3,
};
