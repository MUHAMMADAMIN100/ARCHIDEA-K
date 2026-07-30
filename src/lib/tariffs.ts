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

async function fetchLive(): Promise<Pricing | null> {
  /*
   * Свой домен: адрес CRM знает только сервер (api/tariffs.js). Раньше здесь
   * требовалась переменная сборки VITE_CRM_API_URL — без неё сайт молча
   * оставался на резервных ценах, и новые услуги на нём не появлялись.
   */
  try {
    const res = await fetch('/api/tariffs');
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
        const medium = Number(row.priceMedium) || Number(row.pricePerSqm) || 0;
        const light = Number(row.priceLight) || medium;
        const heavy = Number(row.priceHeavy) || medium;
        if (!(medium > 0 || light > 0)) return null; // цена не задана — не показываем
        const perSeat = (row.unit ?? 'м²') !== 'м²';
        return {
          id,
          title: row.title || base?.title || id,
          prices: {
            light: light > 0 ? light : medium,
            medium: medium > 0 ? medium : light,
            heavy: heavy > 0 ? heavy : medium || light,
          },
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
      }));

    // пустой ответ не должен обнулить калькулятор — остаёмся на резервных
    if (types.length === 0) return null;
    return { types, extras: extras.length ? extras : STATIC_PRICING.extras };
  } catch {
    return null;
  }
}

function loadLive(): Promise<Pricing | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchLive().then((p) => {
      if (p) cached = p;
      return p;
    });
  }
  return inflight;
}

/** Актуальные цены: мгновенно резервные, затем живые из CRM */
export function usePricing(): Pricing {
  const [pricing, setPricing] = useState<Pricing>(() => cached ?? STATIC_PRICING);
  useEffect(() => {
    let active = true;
    loadLive().then((p) => {
      if (active && p) setPricing(p);
    });
    return () => {
      active = false;
    };
  }, []);
  return pricing;
}
