import { planNote, itemsFromOrder } from './proposal-items';

/**
 * Срок работ и состав услуги в КП.
 *
 * Проверяется то, что видит клиент в готовом предложении: сколько дней и
 * сколько людей, и что именно входит в услугу. Ошибка здесь уходит наружу —
 * в документ, по которому с нами расплачиваются.
 */
describe('planNote — планируемый срок работ', () => {
  it('596 м² при выработке 60 — пять дней силами двоих', () => {
    // 596 / 60 = 10 человеко-дней; горизонт 5 дней → 2 человека
    expect(planNote(596, 60)).toBe(
      'Планируемая сдача работы 5 дней. На объекте будут работать 2 человека в день.',
    );
  });

  it('малый объём укладывается в один день одним человеком', () => {
    expect(planNote(50, 60)).toBe(
      'Планируемая сдача работы 1 день. На объекте будут работать 1 человек в день.',
    );
  });

  it('склоняет дни и людей по числу', () => {
    // 180 / 60 = 3 человеко-дня → 3 дня по одному человеку
    expect(planNote(180, 60)).toContain('3 дня');
    expect(planNote(180, 60)).toContain('1 человек в день');
  });

  it('без выработки строки нет — пустой срок хуже отсутствия', () => {
    expect(planNote(596, null)).toBeNull();
    expect(planNote(596, 0)).toBeNull();
    expect(planNote(596, undefined)).toBeNull();
  });

  it('без объёма строки нет', () => {
    expect(planNote(0, 60)).toBeNull();
  });

  it('людей хватает на объём: человеко-дни не теряются', () => {
    for (const [volume, output] of [
      [596, 60],
      [1000, 60],
      [212, 60],
      [70, 8],
      [119, 40],
    ] as [number, number][]) {
      const personDays = Math.ceil(volume / output);
      const text = planNote(volume, output)!;
      const days = Number(text.match(/работы (\d+)/)![1]);
      const people = Number(text.match(/работать (\d+)/)![1]);
      expect(days * people).toBeGreaterThanOrEqual(personDays);
      expect(days).toBeLessThanOrEqual(5);
    }
  });
});

describe('itemsFromOrder — состав услуги попадает в смету', () => {
  const tariff = {
    key: 'GENERAL',
    title: 'Генеральная уборка дома',
    unit: 'м²',
    hasLevels: false,
    priceLight: 33,
    priceMedium: 33,
    priceHeavy: 33,
    pricePerSqm: 33,
    includedWorks: ['очистка потолков', 'мойка люстр', 'вынос мусора'],
    outputPerDay: 60,
  };

  const order = {
    serviceKey: 'GENERAL',
    cleaningType: 'GENERAL',
    area: 596,
    seats: null,
    dirtLevel: null,
    pricePerSqm: 33,
    discount: null,
    extras: null,
    additionalServices: null,
  };

  it('заказ без основной услуги: в смету идут одни доп. услуги', () => {
    const безУслуги = {
      ...order,
      serviceKey: null,
      area: 0,
      pricePerSqm: null,
      customExtras: [
        { title: 'Химчистка мягкой мебели', price: 140, checked: true },
        { title: 'Мойка матраса', price: 250, checked: true },
      ],
    };
    const items = itemsFromOrder(безУслуги, [tariff], []);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual([
      'Химчистка мягкой мебели',
      'Мойка матраса',
    ]);
    expect(items.reduce((s, i) => s + (i.amount ?? 0), 0)).toBe(390);
  });

  it('снятая галочка доп. услуги в смету не попадает', () => {
    const items = itemsFromOrder(
      {
        ...order,
        serviceKey: null,
        area: 0,
        pricePerSqm: null,
        customExtras: [
          { title: 'Мойка окон', price: 250, checked: true },
          { title: 'Передумали', price: 900, checked: false },
        ],
      },
      [tariff],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(250);
  });

  it('строки заказа отменяют список ключей — двойного счёта нет', () => {
    const каталог = [{ key: 'WINDOWS', title: 'Мойка окон', price: 250, hasQty: false }];
    const items = itemsFromOrder(
      {
        ...order,
        area: 0,
        serviceKey: null,
        pricePerSqm: null,
        extras: { WINDOWS: 1 },
        customExtras: [{ title: 'Мойка окон', price: 250, checked: true }],
      },
      [tariff],
      каталог,
    );
    expect(items).toHaveLength(1);
  });

  it('строка работ несёт состав и срок', () => {
    const [work] = itemsFromOrder(order, [tariff], []);
    expect(work.title).toBe('Генеральная уборка дома');
    expect(work.amount).toBe(596 * 33); // 19 668 — как в бумажном бланке
    expect(work.includes).toEqual([
      'очистка потолков',
      'мойка люстр',
      'вынос мусора',
    ]);
    expect(work.note).toContain('Планируемая сдача работы');
  });

  it('услуга без состава в справочнике не ломает смету', () => {
    const bare = { ...tariff, includedWorks: undefined, outputPerDay: null };
    const [work] = itemsFromOrder(order, [bare], []);
    expect(work.amount).toBe(596 * 33);
    expect(work.includes).toBeNull();
    expect(work.note).toBeNull();
  });
});
