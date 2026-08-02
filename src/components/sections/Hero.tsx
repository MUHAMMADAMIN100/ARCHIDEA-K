import { motion } from 'framer-motion';
import { IconArrowDown, IconCheck } from '../ui/icons';
import { COMPANY } from '../../config/company';
import { usePricing } from '../../lib/tariffs';
import { scrollToId } from '../../lib/scroll';

const PERKS = ['Безопасная химия', 'Гарантия качества', 'Оплата после уборки'];

export function Hero() {
  const pricing = usePricing();
  const minPrice =
    pricing.types.find((t) => t.id === 'general')?.prices.light ?? 25;
  return (
    <section
      id="top"
      className="relative flex min-h-screen items-center overflow-hidden bg-navy-gradient pt-16 text-white"
    >
      {/* Декоративные свечения */}
      <div className="pointer-events-none absolute inset-0 bg-hero-radial" />
      <motion.div
        className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.55, 0.3] }}
        transition={{ duration: 8, repeat: Infinity }}
      />
      <motion.div
        className="pointer-events-none absolute -right-10 bottom-10 h-80 w-80 rounded-full bg-navy-500/40 blur-3xl"
        animate={{ scale: [1.1, 1, 1.1], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 10, repeat: Infinity }}
      />
      {/* Плавающие «пузырьки чистоты» */}
      {[...Array(6)].map((_, i) => (
        <motion.span
          key={i}
          className="pointer-events-none absolute rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur"
          style={{
            width: 12 + i * 8,
            height: 12 + i * 8,
            left: `${10 + i * 15}%`,
            top: `${20 + ((i * 13) % 60)}%`,
          }}
          animate={{ y: [0, -30, 0], opacity: [0.2, 0.6, 0.2] }}
          transition={{ duration: 6 + i, repeat: Infinity, delay: i * 0.5 }}
        />
      ))}

      <div className="container-px relative grid items-center gap-12 py-16 lg:grid-cols-2">
        {/* Левая колонка — текст */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm text-white backdrop-blur"
          >
            Профессиональный клининг в {COMPANY.city}
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl"
          >
            Чистота, которой
            <br />
            <span className="text-white">можно доверять</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-5 max-w-md text-lg text-white/70"
          >
            Генеральная уборка, уборка после ремонта и мойка мягкой мебели.
            Проверенный персонал, безопасные средства и гарантия результата.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-8 flex flex-wrap items-center gap-4"
          >
            <button onClick={() => scrollToId('request')} className="btn-white text-base">
              Рассчитать стоимость
              <IconArrowDown className="h-5 w-5" />
            </button>
            {/* Оба рабочих номера — чтобы дозвонились с первого раза */}
            {COMPANY.phones.map((p) => (
              <a key={p.href} href={p.href} className="btn-outline-light">
                {p.display}
              </a>
            ))}
          </motion.div>

          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.45 }}
            className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70"
          >
            {PERKS.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <IconCheck className="h-4 w-4 text-white" />
                {p}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* Правая колонка — БЕЛАЯ карточка (контраст к тёмному фону) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto w-full max-w-md"
        >
          <div className="animate-float-slow rounded-3xl bg-white p-8 text-navy-900 shadow-glow">
            <div className="flex items-center justify-between">
              <span className="text-sm text-navy-500">Стоимость от</span>
              <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-semibold text-navy-700">
                выгодно
              </span>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-5xl font-extrabold text-navy-900">
                {minPrice}
              </span>
              <span className="mb-1.5 text-navy-500">сомони / м²</span>
            </div>
            <div className="mt-6 space-y-3">
              {[
                ['Выполнено заказов', '10 000+'],
                ['Выезд по городу', `${COMPANY.city}`],
                ['Время уборки', 'от 2 часов'],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between rounded-2xl bg-navy-50 px-4 py-3 text-sm"
                >
                  <span className="text-navy-500">{k}</span>
                  <span className="font-semibold text-navy-900">{v}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => scrollToId('request')}
              className="btn-primary mt-6 w-full"
            >
              Узнать точную цену
            </button>
          </div>

          {/* Бейдж-«отзыв» */}
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 5, repeat: Infinity }}
            className="absolute -left-6 -top-6 hidden rounded-2xl border border-white/10 bg-navy-500 px-4 py-3 text-white shadow-card sm:block"
          >
            <div className="text-xs text-white/60">Рейтинг клиентов</div>
            <div className="text-lg font-bold text-white">★ 4.9 / 5.0</div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
