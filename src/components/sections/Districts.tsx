import { Reveal } from '../ui/Reveal';
import { DISTRICTS, COMPANY } from '../../config/company';

export function Districts() {
  return (
    <section
      id="districts"
      className="border-y border-navy-100 bg-mist py-12 sm:py-14"
    >
      <div className="container-px">
        <Reveal>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
            <div className="min-w-0 max-w-md">
              <p className="section-eyebrow !mb-2">География</p>
              <h2 className="text-xl font-bold tracking-[-0.02em] text-navy-900 sm:text-2xl">
                Выезжаем по {COMPANY.city} и рядом
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-navy-500">
                Если вашего района нет в списке — напишите, уточним выезд.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2 sm:max-w-lg sm:justify-end">
              {DISTRICTS.map((d) => (
                <li
                  key={d}
                  className="rounded-md border border-navy-100 bg-white px-3 py-1.5 text-sm font-medium tracking-[-0.01em] text-navy-700"
                >
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
