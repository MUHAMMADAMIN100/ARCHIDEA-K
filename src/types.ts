import type { CleaningType, DirtLevel } from './config/pricing';

/** Состояние калькулятора (Шаг 1) */
export interface CalculatorState {
  area: number;
  cleaningTypeId: CleaningType['id'];
  /** Степень загрязнения (для уборки по м²) */
  dirtLevel: DirtLevel;
  /** Посадочные места (для мойки мягкой мебели) */
  seats: number;
  /** id доп.услуги -> количество (для услуг без количества: 0 = выкл, 1 = вкл) */
  extras: Record<string, number>;
}

/** Анкета — специфика объекта (Шаг 2) */
export interface QuizState {
  date: string;
  time: string;
  hasUtilities: 'yes' | 'no' | '';
  access: 'keys' | 'onsite' | '';
  comment: string;
}

/** Контактные данные (Шаг 3) */
export interface ContactState {
  name: string;
  phone: string;
  /**
   * Запасной номер — обязателен наравне с основным.
   * По нему звонят, когда по первому не дозвонились: без второго контакта
   * заявка нередко «зависала» на несколько дней.
   */
  phone2: string;
  address: string;
}

/** Полная заявка для отправки */
export interface OrderPayload {
  calculator: CalculatorState;
  quiz: QuizState;
  contact: ContactState;
  total: number;
  /** Расчёт по актуальным (живым) ценам на момент отправки */
  breakdown?: PriceBreakdown;
}

/** Детализация расчёта (для отображения «Итого») */
export interface PriceBreakdown {
  base: number;
  extras: { title: string; qty: number; sum: number }[];
  total: number;
}
