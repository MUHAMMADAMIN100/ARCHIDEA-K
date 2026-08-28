import { DirtLevel } from '@prisma/client';
import {
  PricingExtra,
  PricingTariff,
  billableUnits,
  calculatePrice,
  extrasTotal,
  unitPrice,
} from './order-pricing';

/**
 * Расчёт стоимости заказа. Цена считается ТОЛЬКО здесь и только на сервере,
 * поэтому любая ошибка сразу становится деньгами компании.
 */

const CLEANING: PricingTariff = {
  key: 'GENERAL',
  unit: 'м²',
  hasLevels: true,
  priceLight: 25,
  priceMedium: 27,
  priceHeavy: 29,
  pricePerSqm: 27,
};

const FURNITURE: PricingTariff = {
  key: 'FURNITURE',
  unit: 'место',
  hasLevels: false,
  priceLight: 70,
  priceMedium: 70,
  priceHeavy: 70,
  pricePerSqm: 70,
};

const CATALOGUE: PricingExtra[] = [
  { key: 'windows', price: 50, hasQty: true },
  { key: 'fridge', price: 80, hasQty: false },
];

describe('Цена за единицу по степени загрязнения', () => {
  it('лёгкая, средняя и тяжёлая берут свои цены', () => {
    expect(unitPrice(CLEANING, DirtLevel.LIGHT)).toBe(25);
    expect(unitPrice(CLEANING, DirtLevel.MEDIUM)).toBe(27);
    expect(unitPrice(CLEANING, DirtLevel.HEAVY)).toBe(29);
  });

  it('степень не указана — считаем по средней', () => {
    expect(unitPrice(CLEANING, null)).toBe(27);
    expect(unitPrice(CLEANING, undefined)).toBe(27);
  });

  it('услуга без степеней всегда идёт по одной цене', () => {
    expect(unitPrice(FURNITURE, DirtLevel.HEAVY)).toBe(70);
  });

  it('услуги нет — цена ноль, а не падение', () => {
    expect(unitPrice(null, DirtLevel.MEDIUM)).toBe(0);
  });
});

describe('Что именно оплачивается', () => {
  it('уборка считается по площади', () => {
    expect(billableUnits({ area: 50, seats: 4 }, CLEANING)).toBe(50);
  });

  it('мебель — по посадочным местам, площадь игнорируется', () => {
    expect(billableUnits({ area: 50, seats: 4 }, FURNITURE)).toBe(4);
  });

  it('отрицательный и нулевой объём не оплачивается', () => {
    expect(billableUnits({ area: -10 }, CLEANING)).toBe(0);
    expect(billableUnits({ area: 0 }, CLEANING)).toBe(0);
  });
});

describe('Доп. услуги', () => {
  it('услуга с количеством умножается, без количества — считается один раз', () => {
    expect(extrasTotal({ windows: 3 }, CATALOGUE)).toBe(150);
    expect(extrasTotal({ fridge: 5 }, CATALOGUE)).toBe(80);
  });

  it('удалённая из справочника услуга в сумму не берётся', () => {
    expect(extrasTotal({ unknown: 10 }, CATALOGUE)).toBe(0);
  });

  it('нулевое и отрицательное количество не считается', () => {
    expect(extrasTotal({ windows: 0 }, CATALOGUE)).toBe(0);
    expect(extrasTotal({ windows: -3 }, CATALOGUE)).toBe(0);
  });

  it('пустой ввод не ломает расчёт', () => {
    expect(extrasTotal(null, CATALOGUE)).toBe(0);
    expect(extrasTotal({ windows: 3 }, null)).toBe(0);
  });
});

describe('Итоговый расчёт заказа', () => {
  it('уборка: площадь × ставка', () => {
    const r = calculatePrice({ area: 50, dirtLevel: DirtLevel.MEDIUM }, CLEANING);
    expect(r.units).toBe(50);
    expect(r.pricePerUnit).toBe(27);
    expect(r.workTotal).toBe(1350);
    expect(r.total).toBe(1350);
  });

  it('мебель: места × цена за место', () => {
    const r = calculatePrice({ seats: 3 }, FURNITURE);
    expect(r.unit).toBe('место');
    expect(r.total).toBe(210);
  });

  it('ручная цена за единицу перебивает справочник', () => {
    const r = calculatePrice(
      { area: 50, pricePerSqm: 40, dirtLevel: DirtLevel.MEDIUM },
      CLEANING,
    );
    expect(r.pricePerUnit).toBe(40);
    expect(r.total).toBe(2000);
  });

  it('доп. услуги прибавляются к работам', () => {
    const r = calculatePrice(
      { area: 50, dirtLevel: DirtLevel.MEDIUM, extras: { windows: 2 } },
      CLEANING,
      CATALOGUE,
    );
    expect(r.extrasTotal).toBe(100);
    expect(r.subtotal).toBe(1450);
    expect(r.total).toBe(1450);
  });

  it('дополнительные основные услуги входят в сумму работ', () => {
    const r = calculatePrice(
      { area: 50, dirtLevel: DirtLevel.MEDIUM, additionalWork: 600 },
      CLEANING,
    );
    expect(r.workTotal).toBe(1950);
    expect(r.total).toBe(1950);
  });

  it('скидка вычитается из итога', () => {
    const r = calculatePrice(
      { area: 50, dirtLevel: DirtLevel.MEDIUM, discount: 350 },
      CLEANING,
    );
    expect(r.discount).toBe(350);
    expect(r.total).toBe(1000);
  });

  it('скидка не может увести заказ в минус', () => {
    const r = calculatePrice(
      { area: 50, dirtLevel: DirtLevel.MEDIUM, discount: 99999 },
      CLEANING,
    );
    expect(r.discount).toBe(1350);
    expect(r.total).toBe(0);
  });

  it('отрицательная скидка не превращается в наценку', () => {
    const r = calculatePrice(
      { area: 50, dirtLevel: DirtLevel.MEDIUM, discount: -500 },
      CLEANING,
    );
    expect(r.discount).toBe(0);
    expect(r.total).toBe(1350);
  });

  it('опечатка в площади не переполняет целое поле базы', () => {
    const r = calculatePrice(
      { area: 999_999_999, dirtLevel: DirtLevel.HEAVY },
      CLEANING,
    );
    expect(r.workTotal).toBeLessThanOrEqual(2_000_000_000);
    expect(r.total).toBeLessThanOrEqual(2_000_000_000);
  });

  it('пустой заказ считается в ноль, а не падает', () => {
    const r = calculatePrice({}, null);
    expect(r.total).toBe(0);
    expect(r.units).toBe(0);
  });

  /**
   * Регрессия найденного дефекта.
   *
   * Заявка с сайта приходит с суммой, в которую УЖЕ входят доп. услуги.
   * Пока цена за единицу вычислялась как «сумма ÷ площадь», в неё попадали
   * окна и духовка. Дальше эта цифра подставлялась в расчёт как заданная
   * вручную — и доп. услуги начислялись второй раз: заказ на 4530 сомони
   * превращался в 4890 при правке одного только адреса.
   *
   * Тесты ниже фиксируют оба правила, на которых держится исправление.
   */
  describe('Регрессия: доп. услуги не должны начисляться дважды', () => {
    const area = 120;
    const extras = { windows: 5, fridge: 1 }; // 5×50 + 80 = 330
    const workOnly = area * CLEANING.priceHeavy; // 3480
    const withExtras = workOnly + 330;

    it('цена за единицу из справочника даёт верный итог', () => {
      const r = calculatePrice(
        { area, dirtLevel: DirtLevel.HEAVY, extras },
        CLEANING,
        CATALOGUE,
      );
      expect(r.pricePerUnit).toBe(CLEANING.priceHeavy);
      expect(r.total).toBe(withExtras);
    });

    it('цена, выведенная из суммы С ДОПАМИ, завышает итог — так делать нельзя', () => {
      const derived = Math.round(withExtras / area); // ровно то, что считалось раньше
      const r = calculatePrice(
        { area, dirtLevel: DirtLevel.HEAVY, pricePerSqm: derived, extras },
        CLEANING,
        CATALOGUE,
      );
      expect(r.total).toBeGreaterThan(withExtras);
    });

    it('без ручной цены расчёт идёт по справочнику, а не по прошлому значению', () => {
      const auto = calculatePrice({ area, dirtLevel: DirtLevel.LIGHT }, CLEANING);
      expect(auto.pricePerUnit).toBe(CLEANING.priceLight);

      // сменили степень загрязнения и НЕ передали цену — она обязана обновиться
      const next = calculatePrice(
        { area, dirtLevel: DirtLevel.HEAVY, pricePerSqm: null },
        CLEANING,
      );
      expect(next.pricePerUnit).toBe(CLEANING.priceHeavy);
      expect(next.total).toBe(area * CLEANING.priceHeavy);
    });

    it('явно заданная менеджером цена по-прежнему главнее справочника', () => {
      const r = calculatePrice(
        { area, dirtLevel: DirtLevel.HEAVY, pricePerSqm: 50 },
        CLEANING,
      );
      expect(r.pricePerUnit).toBe(50);
      expect(r.total).toBe(area * 50);
    });
  });

  it('сумма всегда сходится: работы + допы − скидка', () => {
    const r = calculatePrice(
      {
        area: 80,
        dirtLevel: DirtLevel.HEAVY,
        extras: { windows: 4, fridge: 1 },
        additionalWork: 500,
        discount: 300,
      },
      CLEANING,
      CATALOGUE,
    );
    expect(r.workTotal).toBe(80 * 29 + 500);
    expect(r.extrasTotal).toBe(4 * 50 + 80);
    expect(r.subtotal).toBe(r.workTotal + r.extrasTotal);
    expect(r.total).toBe(r.subtotal - r.discount);
  });
});

describe('Заказ без основной услуги', () => {
  it('площадь не оплачивается, в сумму идут одни доп. услуги', () => {
    const r = calculatePrice(
      {
        serviceKey: null,
        area: 100,
        pricePerSqm: 30,
        customExtras: [
          { title: 'Химчистка мягкой мебели', price: 140, checked: true },
          { title: 'Мойка матраса', price: 250, checked: true },
        ],
      },
      CLEANING,
      CATALOGUE,
    );
    expect(r.units).toBe(0);
    expect(r.workTotal).toBe(0);
    expect(r.total).toBe(390);
  });

  it('пустая строка в услуге значит то же, что и отсутствие услуги', () => {
    const r = calculatePrice(
      { serviceKey: '', area: 100, pricePerSqm: 30 },
      CLEANING,
      CATALOGUE,
    );
    expect(r.total).toBe(0);
  });

  it('обычный заказ считает площадь как прежде', () => {
    const r = calculatePrice(
      { serviceKey: 'GENERAL', area: 100, pricePerSqm: 30 },
      CLEANING,
      CATALOGUE,
    );
    expect(r.workTotal).toBe(3000);
  });
});
