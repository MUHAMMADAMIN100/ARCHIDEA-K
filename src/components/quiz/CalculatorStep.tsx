import { FieldLabel, OptionCard, Chip } from './fields';
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
    <div className="quiz-stack space-y-5 sm:space-y-6">
      {/* Услуга: 3 в ряд уже с xs */}
      <div>
        <FieldLabel required hint="Выберите тип услуги">
          Что нужно сделать?
        </FieldLabel>
        <div className="grid grid-cols-1 gap-2 xs:grid-cols-3 min-[400px]:grid-cols-3">
          {pricing.types.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id)}
              className={`press rounded-lg border px-2.5 py-2.5 text-left transition-colors duration-120 ease-out sm:px-3 sm:py-3 ${
                state.cleaningTypeId === t.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-navy-200 bg-white hover:border-navy-300'
              }`}
            >
              <span className="quiz-option-title block leading-tight">
                {t.title}
              </span>
              <span className="quiz-option-meta mt-0.5 block">
                {t.perSeat
                  ? `${t.prices.light} ${CURRENCY}/место`
                  : `от ${t.prices.light} ${CURRENCY}/м²`}
              </span>
            </button>
          ))}
        </div>
      </div>

      {isFurniture ? (
        <div>
          <FieldLabel required>Посадочные места</FieldLabel>
          <div className="relative">
            <input
              inputMode="numeric"
              value={state.seats || ''}
              onChange={(e) => setSeats(e.target.value)}
              placeholder="3"
              className="quiz-value w-full rounded-lg border border-navy-200 bg-mist/40 px-3 py-3 pr-14 sm:px-4 sm:py-3.5 sm:pr-16 placeholder:text-sm placeholder:font-normal placeholder:text-navy-300 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <span className="quiz-option-meta absolute right-3 top-1/2 -translate-y-1/2 sm:right-4">
              мест
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
            {[2, 3, 4, 5, 6].map((v) => (
              <Chip
                key={v}
                active={state.seats === v}
                onClick={() => onChange({ ...state, seats: v })}
              >
                {v}
              </Chip>
            ))}
          </div>
          <p className="quiz-hint mt-2">
            1 место = сиденье дивана или кресло.
          </p>
        </div>
      ) : (
        <>
          <div>
            <FieldLabel required>Площадь помещения</FieldLabel>
            <div className="relative">
              <input
                inputMode="numeric"
                value={state.area || ''}
                onChange={(e) => setArea(e.target.value)}
                placeholder="60"
                className="quiz-value w-full rounded-lg border border-navy-200 bg-mist/40 px-3 py-3 pr-12 sm:px-4 sm:py-3.5 sm:pr-14 placeholder:text-sm placeholder:font-normal placeholder:text-navy-300 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              <span className="quiz-option-meta absolute right-3 top-1/2 -translate-y-1/2 font-medium sm:right-4">
                м²
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
              {[40, 60, 80, 100, 120].map((v) => (
                <Chip
                  key={v}
                  active={state.area === v}
                  onClick={() => onChange({ ...state, area: v })}
                >
                  {v}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel required hint="Влияет на цену за м²">
              Степень загрязнения
            </FieldLabel>
            <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
              {DIRT_LEVELS.map((d) => (
                <OptionCard
                  key={d.id}
                  active={state.dirtLevel === d.id}
                  onClick={() => onChange({ ...state, dirtLevel: d.id })}
                  title={d.title}
                  subtitle={
                    type
                      ? `${type.prices[d.id]} ${CURRENCY}/м² · ${d.hint}`
                      : d.hint
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <FieldLabel hint="Необязательно">Дополнительные услуги</FieldLabel>
            <div className="divide-y divide-navy-100 overflow-hidden rounded-lg border border-navy-200 bg-white">
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
                    className={`flex min-h-[2.75rem] min-w-0 cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors duration-120 ease-out sm:min-h-[3rem] sm:gap-3 sm:px-3.5 sm:py-2.5 ${
                      active ? 'bg-brand-50/80' : 'hover:bg-mist/50'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                        active
                          ? 'border-brand-500 bg-brand-500 text-white'
                          : 'border-navy-300 text-transparent'
                      }`}
                    >
                      <IconCheck className="h-3 w-3" />
                    </span>
                    {Icon && (
                      <span className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md bg-mist text-navy-600 sm:flex">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="quiz-option-title truncate">{s.title}</div>
                      <div className="quiz-option-meta">
                        +{s.price} {CURRENCY}
                        {s.hasQuantity && s.unit ? ` / ${s.unit}` : ''}
                      </div>
                    </div>
                    {s.hasQuantity && (
                      <div
                        className="flex shrink-0 items-center gap-0.5 sm:gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setQty(s.id, qty - 1)}
                          className="press flex h-7 w-7 items-center justify-center rounded-md border border-navy-200 bg-white text-sm text-navy-700 hover:bg-mist disabled:opacity-40"
                          disabled={qty <= 0}
                          aria-label="Меньше"
                        >
                          −
                        </button>
                        <span className="quiz-option-title w-5 text-center tabular-nums">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQty(s.id, qty + 1)}
                          className="press flex h-7 w-7 items-center justify-center rounded-md border border-navy-200 bg-white text-sm text-navy-700 hover:bg-mist"
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

      <p className="quiz-hint">
        Сумма предварительная. Минимум — {formatPrice(MIN_ORDER_PRICE)}.
      </p>
    </div>
  );
}
