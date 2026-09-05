import { useEffect, useState } from 'react';
import {
  CLEANING_TYPES,
  EXTRA_SERVICES,
  type CleaningType,
  type ExtraService,
} from '../config/pricing';

/**
 * Живые цены из CRM «Archidea Sistem».
 * Публичный эндпоинт GET /tariffs отдаёт актуальные тарифы —
 * руководитель меняет цены в CRM, сайт подхватывает автоматически.
 * При недоступности CRM используются резервные цены из config/pricing.ts.
 */

export interface Pricing {
  types: CleaningType[];
  extras: ExtraService[];
}

const STATIC_PRICING: Pricing = {
  types: CLEANING_TYPES,
  extras: EXTRA_SERVICES,
};

/*
 * Последний удачный ответ CRM.
 *
 * Держим его и в памяти, и в хранилище браузера — чтобы при следующем
 * открытии сайта сразу показать актуальный список, а не резервный из
 * конфигурации. Иначе скрытая услуга на долю секунды мелькала бы на экране.
 * Это именно снимок последнего ответа, а не кэш: свежий запрос уходит всё
 * равно и при каждом открытии, и при возврате на вкладку.
 */
const SNAPSHOT_KEY = 'archidea:pricing:v1';

function readSnapshot(): Pricing | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pricing;
    return Array.isArray(p?.types) && Array.isArray(p?.extras) ? p : null;
  } catch {
    return null;
  }
}

function writeSnapshot(p: Pricing): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(p));
  } catch {
    // приватный режим, переполненное хранилище — не повод ломать страницу
  }
}

let cached: Pricing | null = null;
let inflight: Promise<Pricing | null> | null = null;

/** CRM key → id услуги на лендинге (для трёх базовых — сохраняем прежние id) */
const KEY_TO_ID: Record<string, string> = {
  GENERAL: 'general',
  POST_RENOVATION: 'post_renovation',
  FURNITURE: 'furniture',
};

/** Описание базовых услуг оставляем из конфигурации — оно продающее */
const STATIC_BY_ID = new Map(CLEANING_TYPES.map((t) => [t.id, t]));

/*
 * Единица измерения доп. услуги.
 *
 * В CRM её попросту нет: у доп. услуги хранится только признак «считается
 * количеством». Поэтому берём единицу из конфигурации сайта, а для услуги,
 * заведённой в CRM позже, подставляем «шт» — считают именно штуки (окна,
 * духовки). Без этого на карточке печаталось «+50 сомони / undefined», и та
 * же строка уходила в заявку: «Мытьё окон (3 undefined)».
 */
const STATIC_EXTRA_UNIT = new Map(
  EXTRA_SERVICES.map((e) => [e.id, e.unit] as const),
);
const DEFAULT_EXTRA_UNIT = 'шт';

async function fetchLive(): Promise<Pricing | null> {
  /*
   * Свой домен: адрес CRM знает только сервер (api/tariffs.js). Раньше здесь
   * требовалась переменная сборки VITE_CRM_API_URL — без неё сайт молча
   * оставался на резервных ценах, и новые услуги на нём не появлялись.
   */
  try {
    // no-store: браузер не должен отдавать сохранённый ответ — иначе
    // скрытая в CRM услуга ещё минуту остаётся на экране
    const res = await fetch('/api/tariffs', { cache: 'no-store' });
    if (!res.ok) return null;
    const data: {
      tariffs?: {
        key: string;
        title: string;
        description?: string | null;
        unit?: string | null;
        hasLevels?: boolean;
        priceLight: number;
        priceMedium: number;
        priceHeavy: number;
        pricePerSqm?: number | null;
        minPrice?: number | null;
        minArea?: number | null;
      }[];
      extras?: {
        key: string;
        title: string;
        price: number;
        hasQty?: boolean;
      }[];
    } = await res.json();

    /*
     * Список строим ИЗ ОТВЕТА CRM, а не накладываем цены на готовый список —
     * иначе услуга, которой нет в конфигурации, не попадёт на сайт никогда.
     */
    const types: CleaningType[] = (data.tariffs ?? [])
      .map((row) => {
        const id = KEY_TO_ID[row.key] ?? row.key.toLowerCase();
        const base = STATIC_BY_ID.get(id);
        /*
         * Одна цена — та же, по которой считает CRM (priceMedium; см.
         * order-pricing.ts, unitPrice). Степень загрязнения на неё не влияет.
         */
        const price =
          Number(row.priceMedium) ||
          Number(row.pricePerSqm) ||
          Number(row.priceLight) ||
          0;
        if (!(price > 0)) return null; // цена не задана — не показываем
        const perSeat = (row.unit ?? 'м²') !== 'м²';
        return {
          id,
          title: row.title || base?.title || id,
          price,
          // минимум и порог приходят из карточки услуги в CRM
          minPrice: Math.max(0, Number(row.minPrice) || 0),
          minArea: Math.max(0, Number(row.minArea) || 0),
          perSeat,
          description: row.description || base?.description || '',
          popular: base?.popular,
        } as CleaningType;
      })
      .filter((t): t is CleaningType => t !== null);

    const extras: ExtraService[] = (data.extras ?? [])
      .filter((e) => Number(e.price) > 0)
      .map((e) => ({
        id: e.key,
        title: e.title,
        price: Number(e.price),
        hasQuantity: e.hasQty === true,
        unit: STATIC_EXTRA_UNIT.get(e.key) || DEFAULT_EXTRA_UNIT,
      }));

    /*
     * Отдаём ровно то, что вернула CRM.
     *
     * Раньше пустой список доп. услуг подменялся резервным из конфигурации —
     * и услуги, скрытые руководителем, возвращались на сайт сами собой.
     * Резерв уместен только когда CRM не ответила: тогда fetchLive вернёт
     * null и страница останется на прежних данных.
     */
    return { types, extras };
  } catch {
    return null;
  }
}

/**
 * Запрос за свежим списком. Общий на все блоки страницы: калькулятор, шапка
 * и раздел «Услуги» просят цены одновременно, а запрос должен уйти один.
 * Готовый ответ не запоминаем — следующий вызов снова идёт в CRM.
 */
function loadLive(): Promise<Pricing | null> {
  if (!inflight) {
    inflight = fetchLive().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/**
 * Актуальные услуги и цены.
 *
 * Сразу показываем последний известный список, затем обновляем свежим из
 * CRM — и повторяем при каждом возврате на вкладку. Так услуга, скрытая
 * руководителем, пропадает с сайта при первом же его открытии.
 */
export function usePricing(): Pricing {
  const [pricing, setPricing] = useState<Pricing>(
    () => cached ?? readSnapshot() ?? STATIC_PRICING,
  );
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadLive().then((p) => {
        if (!p) return; // CRM не ответила — оставляем то, что уже показано
        cached = p;
        writeSnapshot(p);
        if (active) setPricing(p);
      });
    };
    refresh();
    const onBack = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      active = false;
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, []);
  return pricing;
}
