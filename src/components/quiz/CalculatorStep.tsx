import { FieldLabel, OptionCard } from './fields';
import {
  IconWindow,
  IconFridge,
  IconOven,
  IconIron,
  IconCheck,
} from '../ui/icons';
import { DIRT_LEVELS, CURRENCY, MIN_ORDER_PRICE } from '../../config/pricing';
import type { Pricing } from '../../lib/tariffs';
import { formatPrice } from '../../lib/format';
import type { CalculatorState } from '../../types';

const EXTRA_ICONS: Record<string, typeof IconWindow> = {
  windows: IconWindow,
  fridge: IconFridge,
  oven: IconOven,
  ironing: IconIron,
};

interface Props {
  state: CalculatorState;
  onChange: (next: CalculatorState) => void;
  pricing: Pricing;
}

export function CalculatorStep({ state, onChange, pricing }: Props) {
  const type = pricing.types.find((t) => t.id === state.cleaningTypeId);
  const isFurniture = !!type?.perSeat;

  const setArea = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    const area = digits === '' ? 0 : Math.min(Number(digits), 100000);
    onChange({ ...state, area });
  };

  const setSeats = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    const seats = digits === '' ? 0 : Math.min(Number(digits), 999);
    onChange({ ...state, seats });
  };

  const setType = (id: CalculatorState['cleaningTypeId']) =>
    onChange({ ...state, cleaningTypeId: id });

  const toggleExtra = (id: string, on: boolean) =>
    onChange({ ...state, extras: { ...state.extras, [id]: on ? 1 : 0 } });

  const setQty = (id: string, qty: number) =>
    onChange({
      ...state,
      extras: { ...state.extras, [id]: Math.max(0, Math.min(qty, 99)) },
    });

  return (
    <div className="space-y-8">
      {/* Услуга */}
      <div>
        <FieldLabel required>Что нужно сделать?</FieldLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          {pricing.types.map((t) => (
            <OptionCard
              key={t.id}
              active={state.cleaningTypeId === t.id}
              onClick={() => setType(t.id)}
              title={t.title}
              subtitle={
                t.perSeat
                  ? `${t.prices.light} ${CURRENCY} / место`
                  : `от ${t.prices.light} ${CURRENCY} / м²`
              }
            />
          ))}
        </div>
      </div>

      {isFurniture ? (
        /* Посадочные места — для мойки мягкой мебели */
        <div>
          <FieldLabel required>Количество посадочных мест</FieldLabel>
          <div className="relative">
            <input
              inputMode="numeric"
              value={state.seats || ''}
              onChange={(e) => setSeats(e.target.value)}
              placeholder="Например, 3"
              className="w-full rounded-2xl border border-navy-200 bg-white px-4 py-4 pr-16 text-2xl font-bold text-navy-900 placeholder:text-base placeholder:font-normal placeholder:text-navy-300 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-200"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-navy-400">
              мест
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[2, 3, 4, 5, 6].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ ...state, seats: v })}
                className={`press rounded-full px-3.5 py-1.5 text-sm transition-[background-color,color,transform] duration-120 ease-out ${
                  state.seats === v
                    ? 'bg-brand-500 text-white'
                    : 'bg-navy-100 text-navy-600 hover:bg-navy-200'
                }`}
              >
                {v} мест{v === 2 ? 'а' : ''}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-navy-400">
            Посадочное место — одно сиденье дивана или кресло. Например, диван
            на 3 места + кресло = 4 места.
          </p>
        </div>
      ) : (
        <>
          {/* Площадь */}
          <div>
            <FieldLabel required>Площадь помещения, м²</FieldLabel>
            <div className="relative">
              <input
                inputMode="numeric"
                value={state.area || ''}
                onChange={(e) => setArea(e.target.value)}
                placeholder="Например, 60"
                className="w-full rounded-2xl border border-navy-200 bg-white px-4 py-4 pr-16 text-2xl font-bold text-navy-900 placeholder:text-base placeholder:font-normal placeholder:text-navy-300 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-200"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-navy-400">
                м²
              </span>
            </div>
            {/* Быстрые пресеты */}
            <div className="mt-3 flex flex-wrap gap-2">
              {[40, 60, 80, 100, 120].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange({ ...state, area: v })}
                  className={`press rounded-full px-3.5 py-1.5 text-sm transition-[background-color,color,transform] duration-120 ease-out ${
                    state.area === v
                      ? 'bg-brand-500 text-white'
                      : 'bg-navy-100 text-navy-600 hover:bg-navy-200'
                  }`}
                >
                  {v} м²
                </button>
              ))}
            </div>
          </div>

          {/* Степень загрязнения */}
          <div>
            <FieldLabel required>Степень загрязнения</FieldLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              {DIRT_LEVELS.map((d) => (
                <OptionCard
                  key={d.id}
                  active={state.dirtLevel === d.id}
                  onClick={() => onChange({ ...state, dirtLevel: d.id })}
                  title={d.title}
                  subtitle={
                    type
                      ? `${type.prices[d.id]} ${CURRENCY} / м² · ${d.hint}`
                      : d.hint
                  }
                />
              ))}
            </div>
          </div>

          {/* Доп. услуги */}
          <div>
            <FieldLabel>Дополнительные услуги</FieldLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              {pricing.extras.map((s) => {
                const qty = state.extras[s.id] ?? 0;
                const active = qty > 0;
                const Icon = EXTRA_ICONS[s.id];
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExtra(s.id, !active)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExtra(s.id, !active);
                      }
                    }}
                    /* min-w-0: без него ячейка сетки держит ширину по самому
                       длинному названию услуги и распирает всю форму.

                       Отклика на нажатие (press) у плитки нет намеренно: внутри
                       живут кнопки «+»/«−», и сжималась бы вся плитка — человек
                       решил бы, что снял услугу, а не изменил количество.
                       Выбор и без того виден сразу: заливка, рамка и галочка. */
                    className={`flex h-[70px] min-w-0 cursor-pointer items-center gap-2.5 rounded-2xl border px-3 transition-[background-color,border-color,box-shadow] duration-120 ease-out ${
                      active
                        ? 'border-navy-500 bg-navy-50 ring-1 ring-navy-300'
                        : 'border-navy-200 bg-white hover:border-navy-400 hover:bg-navy-50'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-120 ease-out ${
                        active
                          ? 'border-navy-500 bg-brand-500 text-white'
                          : 'border-navy-300 text-transparent'
                      }`}
                    >
                      <IconCheck className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-100 text-navy-600">
                      {Icon && <Icon className="h-[18px] w-[18px]" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold leading-tight text-navy-900">
                        {s.title}
                      </div>
                      <div className="whitespace-nowrap text-xs text-navy-500">
                        +{s.price} {CURRENCY}
                        {s.hasQuantity ? ` / ${s.unit}` : ''}
                      </div>
                    </div>

                    {/* Счётчик количества — всегда виден для услуг с qty */}
                    {s.hasQuantity && (
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setQty(s.id, qty - 1)}
                          className="press flex h-6 w-6 items-center justify-center rounded-lg bg-navy-100 text-base leading-none text-navy-700 transition-[background-color,opacity,transform] duration-120 ease-out hover:bg-navy-200 disabled:opacity-40"
                          disabled={qty <= 0}
                          aria-label="Меньше"
                        >
                          −
                        </button>
                        <span className="w-4 text-center text-sm font-semibold text-navy-900">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQty(s.id, qty + 1)}
                          className="press flex h-6 w-6 items-center justify-center rounded-lg bg-navy-100 text-base leading-none text-navy-700 transition-[background-color,transform] duration-120 ease-out hover:bg-navy-200"
                          aria-label="Больше"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <p className="text-center text-xs text-navy-400">
        * Итоговая сумма предварительная. Точную стоимость подтвердит менеджер
        после оформления заявки. Минимальный заказ — {formatPrice(MIN_ORDER_PRICE)}.
      </p>
    </div>
  );
}
