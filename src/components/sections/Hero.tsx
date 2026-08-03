import { motion } from 'framer-motion';
import { IconArrowDown, IconPhone } from '../ui/icons';
import { Img } from '../ui/Img';
import { COMPANY } from '../../config/company';
import { CURRENCY } from '../../config/pricing';
import { usePricing } from '../../lib/tariffs';
import { scrollToId } from '../../lib/scroll';

const STATS = [
  ['10 000+', 'выполненных заказов'],
  ['3 года', 'на рынке Душанбе'],
  ['98%', 'клиентов возвращаются'],
  ['8:00–22:00', 'работаем ежедневно'],
] as const;

export function Hero() {
  const pricing = usePricing();
  const minPrice =
    pricing.types.find((t) => t.id === 'general')?.prices.light ?? 25;

  return (
    <section
      id="top"
      className="relative overflow-hidden bg-snow pt-16 sm:pt-[4.25rem]"
    >
      <div className="container-px pb-12 pt-8 sm:pb-16 sm:pt-14 lg:pb-20 lg:pt-[4.5rem]">
        {/*
          Mobile: фото сразу после короткого оффера (order).
          Desktop: 2 колонки текст | фото.
        */}
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.02fr] lg:gap-16 lg:gap-y-0">
          {/* Copy */}
          <div className="relative z-10 order-1 max-w-xl lg:order-none">
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="section-eyebrow"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" />
              Клининг в {COMPANY.city} · от {minPrice} {CURRENCY}/м²
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.04 }}
              className="text-[1.85rem] font-bold leading-[1.1] tracking-[-0.035em] text-navy-900 sm:text-5xl lg:text-[3.25rem] lg:leading-[1.06]"
            >
              Свободное время
              <br className="hidden sm:block" />{' '}
              <span className="sm:hidden"> </span>
              начинается с{' '}
              <span className="text-brand-500">чистого дома</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.08 }}
              className="mt-3 max-w-md text-[0.9375rem] leading-[1.6] text-navy-500 sm:mt-5 sm:text-lg sm:leading-[1.65]"
            >
              Генеральная, после ремонта и мойка мебели. Без предоплаты —
              оплата после результата.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.12 }}
              className="mt-5 flex flex-wrap items-center gap-2.5 sm:mt-8 sm:gap-3"
            >
              <button
                type="button"
                onClick={() => scrollToId('request')}
                className="btn-primary"
              >
                Рассчитать стоимость
                <IconArrowDown className="h-4 w-4" />
              </button>
              <a
                href={COMPANY.whatsapp}
                target="_blank"
                rel="noreferrer"
                className="btn-outline-dark"
              >
                WhatsApp
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.18 }}
              className="mt-4 hidden flex-wrap items-center gap-x-5 gap-y-2 sm:mt-6 sm:flex"
            >
              {COMPANY.phones.map((p) => (
                <a
                  key={p.href}
                  href={p.href}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-navy-700 transition-colors hover:text-brand-600"
                >
                  <IconPhone className="h-3.5 w-3.5 text-brand-500" />
                  <span className="tabular-nums">{p.display}</span>
                </a>
              ))}
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.22 }}
              className="mt-5 hidden max-w-md border-t border-navy-100 pt-5 text-sm leading-[1.6] text-navy-500 sm:mt-8 sm:block"
            >
              Без предоплаты. Безопасные средства. Оплата после уборки —
              если что-то не так, переделаем.
            </motion.p>
          </div>

          {/* Photo + price — на mobile order-2, ближе к верху после CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="relative order-2 pb-3 sm:pb-4 lg:order-none"
          >
            <div className="photo-frame shadow-lift">
              <div className="aspect-[16/11] sm:aspect-[4/3]">
                <Img
                  base="/images/hero"
                  alt="Чистая светлая гостиная после уборки"
                  className="h-full w-full object-cover object-[center_45%]"
                  width={1280}
                  height={720}
                  priority
                />
              </div>
              <div className="photo-vignette" aria-hidden />
            </div>

            <div className="absolute -bottom-1 left-3 right-3 mx-auto max-w-[16.5rem] sm:-bottom-2 sm:left-auto sm:right-5 sm:mx-0 sm:max-w-none sm:w-[min(100%,17.5rem)]">
              <div className="rounded-xl border border-navy-100 bg-white p-3 shadow-pop sm:rounded-2xl sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-navy-400 sm:text-[0.6875rem]">
                    Стоимость от
                  </span>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[0.625rem] font-semibold text-brand-700 sm:px-2.5 sm:text-[0.6875rem]">
                    без предоплаты
                  </span>
                </div>
                <div className="mt-1 flex items-end gap-1 sm:mt-2 sm:gap-1.5">
                  <span className="text-[1.75rem] font-bold leading-none tracking-[-0.04em] text-navy-900 tabular-nums sm:text-5xl">
                    {minPrice}
                  </span>
                  <span className="mb-0.5 text-xs text-navy-500 sm:mb-1.5 sm:text-sm">
                    {CURRENCY} / м²
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-navy-100 pt-2 sm:mt-3.5 sm:gap-3 sm:pt-3.5">
                  <div>
                    <div className="text-xs font-bold tabular-nums text-navy-900 sm:text-sm">
                      10 000+
                    </div>
                    <div className="mt-0.5 text-[0.625rem] text-navy-400 sm:text-xs">
                      заказов
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold tabular-nums text-navy-900 sm:text-sm">
                      4.9 ★
                    </div>
                    <div className="mt-0.5 text-[0.625rem] text-navy-400 sm:text-xs">
                      рейтинг
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => scrollToId('request')}
                  className="btn-primary mt-2.5 w-full !py-2 text-xs sm:mt-4 sm:!py-3 sm:text-sm"
                >
                  Узнать точную цену
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Trust strip */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.28 }}
          className="mt-12 grid grid-cols-2 gap-2.5 sm:mt-20 sm:grid-cols-4 sm:gap-0 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-navy-100 sm:bg-mist"
        >
          {STATS.map(([num, label], i) => (
            <div
              key={label}
              className={`rounded-xl border border-navy-100 bg-mist px-3 py-4 text-center sm:rounded-none sm:border-0 sm:border-navy-100 sm:px-4 sm:py-6 ${
                i > 0 ? 'sm:border-l' : ''
              }`}
            >
              <div className="text-lg font-bold tracking-[-0.03em] text-navy-900 tabular-nums sm:text-2xl">
                {num}
              </div>
              <div className="mt-0.5 text-[0.6875rem] leading-snug text-navy-500 sm:mt-1 sm:text-[0.8125rem]">
                {label}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
