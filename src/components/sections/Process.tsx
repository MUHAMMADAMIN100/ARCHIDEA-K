import { Reveal } from '../ui/Reveal';
import { scrollToId } from '../../lib/scroll';

const STEPS = [
  {
    n: '1',
    title: 'Оставьте заявку',
    text: 'Площадь и тип уборки в калькуляторе — сразу видите ориентировочную цену.',
  },
  {
    n: '2',
    title: 'Подтвердим детали',
    text: 'Менеджер перезвонит, уточнит адрес и время. Без скрытых доплат.',
  },
  {
    n: '3',
    title: 'Наслаждайтесь чистотой',
    text: 'Клинер приедет вовремя со всем необходимым. Оплата — после результата.',
  },
] as const;

export function Process() {
  return (
    <section id="process" className="section-pad bg-mist">
      <div className="container-px">
        <Reveal>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <p className="section-eyebrow">Как это работает</p>
              <h2 className="section-title">
                Три шага до чистого пространства
              </h2>
            </div>
            <button
              type="button"
              onClick={() => scrollToId('request')}
              className="btn-outline-dark self-start sm:self-auto"
            >
              Начать расчёт
            </button>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <ol className="mt-12 overflow-hidden rounded-xl border border-navy-100 bg-white md:grid md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.n}
                className={`px-6 py-7 sm:px-7 ${
                  i > 0
                    ? 'border-t border-navy-100 md:border-l md:border-t-0'
                    : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white tabular-nums">
                    {s.n}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className="hidden h-px flex-1 bg-navy-100 md:block"
                    />
                  )}
                </div>
                <h3 className="section-h3 mt-5">{s.title}</h3>
                <p className="body-sm mt-2">{s.text}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
