import { Reveal } from '../ui/Reveal';
import { MobileHScroll } from '../ui/MobileHScroll';
import { COMPANY } from '../../config/company';

/** Реальные отзывы из Instagram / переписок клиентов Archidea Cleaning */
const REVIEWS = [
  {
    name: 'Мавзунаи Джовид',
    handle: '@mavzunai.jovid.official',
    role: 'Клиент',
    text: 'Я вчера только прилетела. Всё так чисто! Спасибо вам большое, я очень довольна. Мне всё понравилось, всё идеально.',
    rating: 5,
  },
  {
    name: 'Заказ 460 м²',
    handle: null as string | null,
    role: 'Крупный объект',
    text: 'Очень понравилось — оправдали все наши ожидания. Всё чисто и вовремя всё сделали. Надеюсь, дальше будем сотрудничать. Спасибо большое девочкам за труд!',
    rating: 5,
  },
  {
    name: 'Tahmina Sweets',
    handle: '@tahmina.sweets',
    role: 'Pastry Shop & Café',
    text: 'Спасибо за качественно проделанную работу! Рекомендуем Archidea Cleaning.',
    rating: 5,
  },
  {
    name: 'Мансур Мухтаров',
    handle: '@mansur_mukhtorov',
    role: 'Дизайнер, Душанбе',
    text: 'Кому нужна идеальная уборка — смело обращайтесь в Archidea Cleaning. От души рекомендую: быстро и профессионально!',
    rating: 5,
  },
] as const;

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${n} из 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          className={`h-3.5 w-3.5 ${i < n ? 'text-amber-400' : 'text-navy-200'}`}
          fill="currentColor"
          aria-hidden
        >
          <path d="M10 1.5l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.27 5.06 16.7l.94-5.5-4-3.9 5.53-.8L10 1.5z" />
        </svg>
      ))}
    </div>
  );
}

function ReviewCard({
  r,
}: {
  r: (typeof REVIEWS)[number];
}) {
  return (
    <blockquote className="flex h-full min-h-[17.5rem] flex-col rounded-xl border border-navy-100 bg-white p-6 shadow-soft sm:min-h-[18.5rem] sm:rounded-2xl sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <Stars n={r.rating} />
        <span className="text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-navy-400">
          Реальный отзыв
        </span>
      </div>
      <p className="mt-4 flex-1 text-[0.9375rem] leading-[1.65] text-navy-700">
        «{r.text}»
      </p>
      <footer className="mt-6 flex items-center gap-3 border-t border-navy-100 pt-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mist text-sm font-bold tracking-tight text-navy-700">
          {r.name.charAt(0)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-[-0.01em] text-navy-900">
            {r.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-navy-400">
            {r.handle ? (
              <>
                {r.handle}
                <span className="text-navy-300"> · </span>
              </>
            ) : null}
            {r.role}
          </div>
        </div>
      </footer>
    </blockquote>
  );
}

export function Testimonials() {
  return (
    <section id="reviews" className="section-pad bg-snow">
      <div className="container-px">
        <Reveal>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <p className="section-eyebrow">Отзывы клиентов</p>
              <h2 className="section-title">Что пишут после уборки</h2>
              <p className="section-lead">
                Настоящие сообщения из Instagram и переписок — без выдуманных
                цитат.
              </p>
            </div>
            <a
              href={COMPANY.instagramReviews}
              target="_blank"
              rel="noreferrer"
              className="btn-outline-dark self-start sm:self-auto"
            >
              Больше в Instagram
            </a>
          </div>
        </Reveal>

        <div className="mt-10 md:mt-12">
          <MobileHScroll
            count={REVIEWS.length}
            ariaLabel="Отзывы — свайп или автолистание"
            gridClass="grid gap-4 sm:grid-cols-2 sm:gap-5"
          >
            {REVIEWS.map((r) => (
              <ReviewCard key={r.name + (r.handle ?? '')} r={r} />
            ))}
          </MobileHScroll>
        </div>
      </div>
    </section>
  );
}
