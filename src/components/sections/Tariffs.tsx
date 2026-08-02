import { Reveal } from '../ui/Reveal';
import { IconCheck, IconArrowRight } from '../ui/icons';
import { DIRT_LEVELS, CURRENCY } from '../../config/pricing';
import { usePricing } from '../../lib/tariffs';
import { scrollToId } from '../../lib/scroll';

/** Что входит в каждую услугу (для карточек) */
const INCLUDES: Record<string, string[]> = {
  general: [
    'Уборка всей заявленной площади',
    'Труднодоступные места',
    'Мытьё стёкол и зеркал',
    'Чистка техники снаружи',
    'Дезинфекция санузлов',
  ],
  post_renovation: [
    'Удаление строительной пыли',
    'Очистка от краски и клея',
    'Мойка всех поверхностей',
    'Вынос строительного мусора',
    'Подготовка к заселению',
  ],
  furniture: [
    'Чистка мягкой мебели от пятен',
    'Устранение неприятных запахов',
    'Безопасная профессиональная химия',
    'Возвращение первозданного вида',
  ],
};

export function Tariffs() {
  const pricing = usePricing(); // живые цены из CRM

  return (
    <section
      id="tariffs"
      className="relative overflow-hidden bg-navy-gradient py-24 text-white"
    >
      <div className="container-px">
        <Reveal>
          <div className="text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-white">
              Наши услуги
            </p>
            <h2 className="section-title mx-auto max-w-2xl">
              Выберите подходящую услугу
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/60">
              Цена уборки зависит от степени загрязнения. Точную стоимость
              рассчитайте в калькуляторе ниже.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {pricing.types.map((type, i) => (
            <Reveal key={type.id} delay={i * 0.1}>
              {/*
                Карточка услуги отзывается на курсор: приподнимается на пиксель
                и добирает тень. Раньше подъём был на восемь — сетка «дышала»
                от каждого движения мыши. Указатель остаётся только на кнопке:
                нажимается именно она.
              */}
              <div
                className={`relative flex h-full flex-col rounded-3xl p-7 transition-[box-shadow,transform,background-color] duration-120 ease-out hover:-translate-y-px ${
                  type.popular
                    ? 'bg-white text-navy-900 shadow-card ring-2 ring-navy-300 hover:shadow-lift'
                    : 'border border-white/10 bg-white/5 text-white hover:bg-white/10'
                }`}
              >
                {type.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-navy-500 px-4 py-1 text-xs font-semibold text-white">
                    Популярный выбор
                  </span>
                )}

                <h3 className="text-xl font-bold">{type.title}</h3>
                <div className="mt-3 flex items-end gap-1.5">
                  {!type.perSeat && (
                    <span className={type.popular ? 'text-sm text-navy-400' : 'text-sm text-white/50'}>
                      от
                    </span>
                  )}
                  <span className="text-4xl font-extrabold">
                    {type.prices.light}
                  </span>
                  <span className={type.popular ? 'mb-1 text-sm text-navy-400' : 'mb-1 text-sm text-white/50'}>
                    {CURRENCY} / {type.perSeat ? 'место' : 'м²'}
                  </span>
                </div>

                {/* Цены по степени загрязнения */}
                {!type.perSeat && (
                  <div
                    className={`mt-3 space-y-1 rounded-2xl p-3 text-xs ${
                      type.popular ? 'bg-navy-50' : 'bg-white/5'
                    }`}
                  >
                    {DIRT_LEVELS.map((d) => (
                      <div key={d.id} className="flex items-center justify-between">
                        <span className={type.popular ? 'text-navy-500' : 'text-white/60'}>
                          {d.title} степень
                        </span>
                        <span className="font-semibold">
                          {type.prices[d.id]} {CURRENCY}/м²
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <p className={`mt-3 text-sm leading-relaxed ${type.popular ? 'text-navy-600' : 'text-white/60'}`}>
                  {type.description}
                </p>

                <ul className="mt-6 flex-1 space-y-3">
                  {INCLUDES[type.id]?.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm">
                      <IconCheck
                        className={`mt-0.5 h-4 w-4 shrink-0 ${type.popular ? 'text-navy-600' : 'text-white'}`}
                      />
                      <span className={type.popular ? 'text-navy-800' : 'text-white/80'}>
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => scrollToId('request')}
                  className={`mt-7 w-full ${type.popular ? 'btn-primary' : 'btn-white'}`}
                >
                  Рассчитать
                  <IconArrowRight className="h-4 w-4" />
                </button>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
