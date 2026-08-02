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
      {/*
        Декораций нет намеренно.
        Здесь были плавающие «пузырьки чистоты», два размытых пятна и
        радиальное свечение — по ним страница и читалась как рекламный
        баннер. Деловому сайту достаточно ровного тёмного фона: внимание
        должно уходить на заголовок и цену, а не на движение.
      */}

      <div className="container-px relative grid items-center gap-12 py-16 lg:grid-cols-2">
        {/* Левая колонка — текст */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-6 inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-1.5 text-sm text-white"
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
          <div className="rounded-md border border-navy-200 bg-white p-8 text-navy-900">
            <div className="flex items-center justify-between">
              <span className="text-sm text-navy-500">Стоимость от</span>
              <span className="rounded-md bg-navy-100 px-2.5 py-1 text-xs font-semibold text-navy-700">
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

          {/*
            Рейтинг — строкой под карточкой, а не плавающим бейджем поверх
            её угла: на светлой карточке такой бейдж наезжал на содержимое
            и выглядел приклеенным.
          */}
          <div className="mt-3 flex items-center justify-between border-t border-white/15 pt-3 text-sm text-white/70">
            <span>Рейтинг клиентов</span>
            <span className="font-semibold text-white">4.9 / 5.0</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
