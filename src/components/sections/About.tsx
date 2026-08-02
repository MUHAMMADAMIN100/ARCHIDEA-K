import { Reveal } from '../ui/Reveal';
import {
  IconUsers,
  IconLeaf,
  IconShield,
  IconClock,
} from '../ui/icons';

const FEATURES = [
  {
    icon: IconUsers,
    title: 'Проверенный персонал',
    text: 'Каждый клинер проходит проверку и обучение. Вы доверяете дом надёжным людям.',
  },
  {
    icon: IconLeaf,
    title: 'Безопасная химия',
    text: 'Используем сертифицированные средства — безопасно для детей, животных и аллергиков.',
  },
  {
    icon: IconShield,
    title: 'Гарантия сохранности',
    text: 'Бережно относимся к вещам и технике. Несём ответственность за сохранность имущества.',
  },
  {
    icon: IconClock,
    title: 'Точно в срок',
    text: 'Приезжаем вовремя и убираем за оговорённое время. Ценим ваше расписание.',
  },
];

const STATS = [
  ['10 000+', 'выполненных заказов'],
  ['3 года', 'на рынке Душанбе'],
  ['4.9★', 'средняя оценка'],
  ['98%', 'клиентов возвращаются'],
];

export function About() {
  return (
    <section id="about" className="relative bg-white py-24 text-navy-900">
      <div className="container-px">
        <Reveal>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-accent">
            Кто мы
          </p>
          <h2 className="section-title max-w-2xl">
            Клининговая компания, которой доверяют дом и офис
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-navy-600">
            «Archidea Cleaning» уже 3 года работает на рынке Душанбе. За это
            время мы выполнили более 10 000 заказов — от квартир и офисов до
            ресторанов, гостиниц и даже самолётов.
          </p>
          <p className="mt-3 max-w-2xl text-navy-500">
            Мы обучаем сотрудников с нуля до уровня профессионала и несём
            социальную миссию: даём стабильную работу и постоянный доход людям
            без квалификации — в первую очередь женщинам.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.08}>
              <div className="card-light group h-full p-6 transition-all duration-300 hover:-translate-y-1 hover:border-navy-300 hover:shadow-glow">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white transition-colors group-hover:bg-brand-600">
                  <f.icon className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy-500">
                  {f.text}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Статистика — тёмная панель внутри белой секции */}
        <Reveal delay={0.1}>
          <div className="mt-12 grid grid-cols-2 gap-4 rounded-3xl bg-navy-gradient p-8 text-white sm:grid-cols-4">
            {STATS.map(([num, label]) => (
              <div key={label} className="text-center">
                <div className="text-3xl font-extrabold text-white sm:text-4xl">
                  {num}
                </div>
                <div className="mt-1 text-sm text-white/60">{label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
