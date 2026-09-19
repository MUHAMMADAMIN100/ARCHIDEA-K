import { describeClosedChanges, diffMembers, memberKey } from './visit-members';

/**
 * Сведение состава выезда с карточкой заказа. На закрытом выезде это уже
 * деньги: добавленный — доначисленная смена, убранный — снятая.
 */
const staff = (id: string, name: string, rate = 230, role = 'Клинер') => ({
  cleanerId: id,
  fullName: name,
  rate,
  role,
});
const guest = (name: string, rate: number) => ({
  cleanerId: null,
  fullName: name,
  rate,
  role: 'Разовый',
});

describe('memberKey — штатные по id, разовые по имени', () => {
  it('штатный — идентификатор клинера', () => {
    expect(memberKey(staff('c1', 'Нозима'))).toBe('c1');
  });
  it('разовый — имя без регистра и пробелов по краям', () => {
    expect(memberKey(guest(' Курбон ', 230))).toBe('гость:курбон');
    expect(memberKey(guest('КУРБОН', 250))).toBe('гость:курбон');
  });
});

describe('diffMembers — что добавить, что убрать, что осталось', () => {
  it('случай «Фархунда»: закрыли с пятью, в карточку дописали шестую', () => {
    const have = [
      staff('k', 'Кибриё', 330, 'Бригадир'),
      staff('z', 'Замира'),
      staff('m', 'Мафтуна'),
      staff('r', 'Рафоат'),
      staff('t', 'Тамано'),
    ];
    const wanted = [...have, staff('g', 'Гулнамо')];
    const d = diffMembers(have, wanted);
    expect(d.toAdd.map((m) => m.fullName)).toEqual(['Гулнамо']);
    expect(d.toRemove).toEqual([]);
    expect(d.kept).toHaveLength(5);
  });

  it('человека убрали из карточки — он в toRemove', () => {
    const have = [staff('a', 'А'), staff('b', 'Б')];
    const d = diffMembers(have, [staff('a', 'А')]);
    expect(d.toRemove.map((m) => m.fullName)).toEqual(['Б']);
    expect(d.toAdd).toEqual([]);
  });

  it('разовый с той же фамилией, но другой суммой — это ТОТ ЖЕ человек (kept), не дубль', () => {
    const have = [guest('Курбон', 250), guest('Дилшод', 250)];
    const wanted = [guest('Курбон', 230), guest('Дилшод', 230)];
    const d = diffMembers(have, wanted);
    expect(d.toAdd).toEqual([]);
    expect(d.toRemove).toEqual([]);
    expect(d.kept.map((p) => [p.have.rate, p.want.rate])).toEqual([[250, 230], [250, 230]]);
  });

  it('штатный и разовый с одинаковым именем не путаются', () => {
    const have = [staff('d', 'Дилшод')];
    const d = diffMembers(have, [staff('d', 'Дилшод'), guest('Дилшод', 230)]);
    expect(d.toAdd.map((m) => m.cleanerId)).toEqual([null]);
    expect(d.kept).toHaveLength(1);
  });

  it('пустой состав в карточке — все в toRemove', () => {
    const d = diffMembers([staff('a', 'А'), guest('Г', 200)], []);
    expect(d.toRemove).toHaveLength(2);
  });
});

describe('describeClosedChanges — запись в журнал словами', () => {
  it('доначисление называет человека и сумму', () => {
    expect(
      describeClosedChanges({
        added: [staff('g', 'Гулнамо')],
        removed: [],
        repriced: [],
        skipped: [],
      }),
    ).toBe('доначислено: Гулнамо (230)');
  });

  it('снятие, разовые и смена суммы — каждое движение названо', () => {
    const text = describeClosedChanges({
      added: [guest('Курбон', 230)],
      removed: [staff('b', 'Нозия'), guest('Старый', 100)],
      repriced: [{ fullName: 'Дилшод', before: 250, after: 230 }],
      skipped: [{ fullName: 'Хангома' }],
    });
    expect(text).toContain('снято: Нозия (230)');
    expect(text).toContain('разовые добавлены: Курбон (230)');
    expect(text).toContain('разовые убраны: Старый');
    expect(text).toContain('сумма изменена: Дилшод 250 → 230');
    expect(text).toContain('смена не начислена (уже есть смена за этот день): Хангома');
  });

  it('нечего описывать — пустая строка', () => {
    expect(describeClosedChanges({ added: [], removed: [], repriced: [], skipped: [] })).toBe('');
  });
});
