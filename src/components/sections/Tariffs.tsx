import { Reveal } from '../ui/Reveal';
import { MobileHScroll } from '../ui/MobileHScroll';
import { Img } from '../ui/Img';
import { IconCheck, IconArrowRight } from '../ui/icons';
import { DIRT_LEVELS, CURRENCY } from '../../config/pricing';
import { usePricing } from '../../lib/tariffs';
import { scrollToId } from '../../lib/scroll';
import type { CleaningType } from '../../config/pricing';

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

/** object-position под композицию кадра (файл тот же) */
const IMAGES: Record<
  string,
  { base: string; alt: string; position: string }
> = {
  general: {
    base: '/images/service-general',
    alt: 'Генеральная уборка',
    position: 'object-[center_40%]',
  },
  post_renovation: {
    base: '/images/service-renovation',
    alt: 'Уборка после ремонта',
    position: 'object-center',
  },
  furniture: {
    base: '/images/service-furniture',
    alt: 'Мойка мягкой мебели',
    position: 'object-[center_35%]',
  },
};

/** Реальные ДО/ПОСЛЕ из Instagram @archidea.cleaning (пост DI3m4VTKUpE) */
const POST_RENO_BA = {
  before: {
    base: '/images/post-renovation-before',
    alt: 'До уборки после ремонта',
    position: 'object-[center_55%]',
  },
  after: {
    base: '/images/post-renovation-after',
    alt: 'После уборки — готово к заселению',
    position: 'object-center',
  },
} as const;

function ServiceMedia({ type }: { type: CleaningType }) {
  /* Услуга «после ремонта» — сплит до/после */
  if (type.id === 'post_renovation') {
    return (
      <div className="relative aspect-[16/10] overflow-hidden bg-navy-100">
        <div className="grid h-full grid-cols-2 gap-px bg-white/50">
          <div className="relative min-w-0 overflow-hidden bg-mist">
            <Img
              base={POST_RENO_BA.before.base}
              alt={POST_RENO_BA.before.alt}
              className={`h-full w-full object-cover ${POST_RENO_BA.before.position} transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]`}
              width={720}
              height={720}
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-900/35 via-transparent to-transparent"
              aria-hidden
            />
            <span className="photo-label-before">До</span>
          </div>
          <div className="relative min-w-0 overflow-hidden bg-mist">
            <Img
              base={POST_RENO_BA.after.base}
              alt={POST_RENO_BA.after.alt}
              className={`h-full w-full object-cover ${POST_RENO_BA.after.position} transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]`}
              width={720}
              height={720}
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-900/20 via-transparent to-transparent"
              aria-hidden
            />
            <span className="photo-label-after">После</span>
          </div>
        </div>
        {/* Разделитель по центру */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-white/70"
        />
      </div>
    );
  }

  const img = IMAGES[type.id];
  if (!img) return null;

  return (
    <div className="relative aspect-[16/10] overflow-hidden bg-mist">
      <Img
        base={img.base}
        alt={img.alt}
        className={`h-full w-full object-cover ${img.position} transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]`}
        width={640}
        height={400}
      />
      <div className="photo-vignette opacity-90" aria-hidden />
      {type.popular && (
        <span className="absolute left-3 top-3 rounded-md bg-brand-500 px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[-0.01em] text-white shadow-soft sm:left-4 sm:top-4">
          Популярный выбор
        </span>
      )}
    </div>
  );
}

function ServiceCard({ type }: { type: CleaningType }) {
  return (
    <article
      className={`group flex h-full flex-col overflow-hidden rounded-xl border bg-white shadow-card transition-[box-shadow,transform] duration-300 ease-out md:hover:-translate-y-0.5 md:hover:shadow-lift sm:rounded-2xl ${
        type.popular
          ? 'border-brand-200 ring-1 ring-brand-100'
          : 'border-navy-100'
      }`}
    >
      <ServiceMedia type={type} />

      <div className="flex flex-1 flex-col p-5 sm:p-6 md:p-7">
        <h3 className="section-h3">{type.title}</h3>

        <div className="mt-3 flex items-end gap-1.5">
          {!type.perSeat && (
            <span className="mb-1 text-sm text-navy-400">от</span>
          )}
          <span className="price-md">{type.prices.light}</span>
          <span className="mb-1 text-sm text-navy-500">
            {CURRENCY} / {type.perSeat ? 'место' : 'м²'}
          </span>
        </div>

        {!type.perSeat && (
          <div className="mt-4 space-y-2 rounded-xl bg-mist px-3.5 py-3 text-xs">
            {DIRT_LEVELS.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-navy-500">{d.title} степень</span>
                <span className="font-semibold tabular-nums text-navy-800">
                  {type.prices[d.id]} {CURRENCY}/м²
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="body-sm mt-3.5">{type.description}</p>

        <ul className="mt-5 flex-1 space-y-2.5">
          {INCLUDES[type.id]?.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 text-sm leading-snug text-navy-700"
            >
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              {item}
            </li>
          ))}
        </ul>

        {/*
          Кнопка не просто прокручивает к калькулятору, а сообщает ему, какую
          услугу выбрали. Раньше человек нажимал «Рассчитать» у «Уборки после
          ремонта», а в калькуляторе стояла генеральная — и он считал не то,
          что смотрел.
        */}
        <button
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('archidea:service', { detail: type.id }),
            );
            scrollToId('request');
          }}
          className={`mt-7 w-full ${
            type.popular ? 'btn-primary' : 'btn-outline-dark'
          }`}
        >
          Рассчитать
          <IconArrowRight className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

export function Tariffs() {
  const pricing = usePricing();

  return (
    <section id="tariffs" className="section-pad bg-mist">
      <div className="container-px">
        <Reveal>
          <div className="max-w-2xl">
            <p className="section-eyebrow">Услуги и цены</p>
            <h2 className="section-title">Выберите подходящую услугу</h2>
            <p className="section-lead">
              Цена зависит от площади и степени загрязнения. Точный расчёт —
              в калькуляторе за минуту.
            </p>
          </div>
        </Reveal>

        <div className="mt-10 md:mt-12">
          <MobileHScroll
            count={pricing.types.length}
            ariaLabel="Услуги — свайп или автолистание"
            gridClass="grid gap-5 lg:grid-cols-3 lg:gap-6"
          >
            {pricing.types.map((type) => (
              <ServiceCard key={type.id} type={type} />
            ))}
          </MobileHScroll>
        </div>
      </div>
    </section>
  );
}
