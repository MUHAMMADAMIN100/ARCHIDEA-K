import { Reveal } from '../ui/Reveal';
import { Img } from '../ui/Img';

const FEATURES = [
  {
    title: 'Проверенный персонал',
    text: 'Каждый клинер проходит проверку и обучение. Вы доверяете дом надёжным людям.',
  },
  {
    title: 'Безопасные средства',
    text: 'Работаем сертифицированной химией — можно не переживать за детей, животных и аллергиков.',
  },
  {
    title: 'Ответственность за вещи',
    text: 'Бережно к мебели и технике. Если что-то не так — переделаем или разберёмся.',
  },
  {
    title: 'Приезжаем вовремя',
    text: 'Договорились на время — будем. Укладываемся в срок, который оговорили.',
  },
] as const;

export function About() {
  return (
    <section id="about" className="section-pad bg-snow">
      <div className="container-px">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <div className="relative">
              <div className="photo-frame">
                <div className="aspect-[4/3]">
                  <Img
                    base="/images/service-general"
                    alt="Профессиональная уборка"
                    className="h-full w-full object-cover object-center transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.03]"
                    width={900}
                    height={675}
                  />
                </div>
                <div className="photo-vignette opacity-80" aria-hidden />
              </div>
              <div className="absolute -bottom-3 left-4 rounded-lg border border-navy-100 bg-white px-4 py-2.5 shadow-pop sm:left-5">
                <div className="text-base font-bold tracking-[-0.02em] text-navy-900 tabular-nums sm:text-lg">
                  3 года
                </div>
                <div className="text-xs text-navy-500">на рынке Душанбе</div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <p className="section-eyebrow">О компании</p>
            <h2 className="section-title">
              Клининг, которому доверяют дом и офис
            </h2>
            <p className="section-lead">
              «Archidea Cleaning» — более 10 000 заказов: квартиры, офисы,
              рестораны, гостиницы. Обучаем сотрудников с нуля и даём стабильную
              работу — в первую очередь женщинам.
            </p>
            <p className="mt-3 max-w-xl text-[0.9375rem] leading-[1.65] text-navy-500">
              Мы приезжаем со своим оборудованием и средствами. Вам остаётся
              только открыть дверь — или передать ключи.
            </p>
          </Reveal>
        </div>

        {/* 2×2 editorial — только линии, без заливок */}
        <Reveal delay={0.08}>
          <div className="mt-14 grid border-t border-navy-100 sm:mt-16 sm:grid-cols-2 sm:gap-x-10">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="border-b border-navy-100 py-5 sm:py-6"
              >
                <h3 className="text-[0.9375rem] font-semibold tracking-[-0.015em] text-navy-900">
                  {f.title}
                </h3>
                <p className="mt-1.5 max-w-sm text-sm leading-[1.6] text-navy-500">
                  {f.text}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
