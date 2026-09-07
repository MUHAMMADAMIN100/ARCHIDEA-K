import { touchesVisits } from './order-update-scope';

/**
 * Синхронизация выездов — дорогая, и запускаться она должна только когда
 * правка реально касается выезда. Иначе сохранение одного комментария
 * держит человека лишние секунды.
 */
describe('touchesVisits — когда правка заказа затрагивает выезды', () => {
  it('комментарий, предпочтения, цена, скидка — выезды не трогают', () => {
    expect(touchesVisits({ comment: 'позвонить заранее' })).toBe(false);
    expect(touchesVisits({ preferences: 'кот' })).toBe(false);
    expect(touchesVisits({ finalPrice: 1500, isManualPrice: true })).toBe(false);
    expect(touchesVisits({ discount: 100, customExtras: [] })).toBe(false);
    expect(touchesVisits({})).toBe(false);
  });

  it('адрес, даты, команда, разовые, состав по дням, менеджер — трогают', () => {
    expect(touchesVisits({ address: 'ул. Рудаки 1' })).toBe(true);
    expect(touchesVisits({ scheduledDate: '2026-09-09' })).toBe(true);
    expect(touchesVisits({ scheduledEndDate: null })).toBe(true);
    expect(touchesVisits({ cleanerIds: [] })).toBe(true);
    expect(touchesVisits({ guestCleaners: [] })).toBe(true);
    expect(touchesVisits({ dayTeams: [] })).toBe(true);
    expect(touchesVisits({ managerId: 'm1' })).toBe(true);
    expect(touchesVisits({ preferredTime: '10:00' })).toBe(true);
  });

  it('поле есть, но равно undefined — «не трогали»', () => {
    expect(touchesVisits({ address: undefined, comment: 'x' })).toBe(false);
  });
});
