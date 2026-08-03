import { Reveal } from '../ui/Reveal';
import { QuizForm } from '../quiz/QuizForm';

export function Calculator() {
  return (
    <section
      id="calculator"
      className="section-pad bg-mist max-[900px]:py-14 sm:max-[900px]:py-16"
    >
      <div className="container-px">
        <Reveal>
          <div className="max-w-2xl">
            <p className="section-eyebrow">Оформление заявки</p>
            <h2 className="section-title">
              Рассчитайте стоимость и оставьте заявку
            </h2>
            <p className="section-lead">
              Три коротких шага: параметры → детали → контакты. Без предоплаты.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <div id="request" className="mt-8 sm:mt-10">
            <QuizForm />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
