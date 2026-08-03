import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Reveal } from '../ui/Reveal';
import { IconChevronDown } from '../ui/icons';
import { COMPANY } from '../../config/company';

const FAQ = [
  {
    q: 'Сколько длится уборка?',
    a: 'Обычно от 2–3 часов для квартиры. Точное время зависит от площади, степени загрязнения и доп. услуг — менеджер скажет после заявки.',
  },
  {
    q: 'Нужно ли что-то готовить к приезду?',
    a: 'Нет. Мы приезжаем со своим оборудованием и средствами. Достаточно обеспечить доступ к воде и электричеству, если они есть на объекте.',
  },
  {
    q: 'Можно ли передать ключи, если меня не будет?',
    a: 'Да. В заявке укажите «передам ключи» — договоримся, как клинер попадёт на объект. Всё обсуждаем заранее.',
  },
  {
    q: 'Когда платить?',
    a: 'Без предоплаты. Оплата после уборки, когда вы приняли результат. Если что-то не так — переделаем.',
  },
  {
    q: 'Чем убираете — безопасно ли для детей и животных?',
    a: 'Используем профессиональную сертифицированную химию. Можно предупредить о аллергиях — подберём средства.',
  },
  {
    q: 'В какие районы выезжаете?',
    a: `Работаем по ${COMPANY.city} и ближайшим районам: Сино, Фирдавси, И. Сомони, Шохмансур, Рудаки и др. Если сомневаетесь — напишите или позвоните.`,
  },
] as const;

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="section-pad bg-snow">
      <div className="container-px">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <p className="section-eyebrow justify-center">Частые вопросы</p>
            <h2 className="section-title">Ответы до заявки</h2>
            <p className="section-lead mx-auto">
              Коротко о сроках, оплате и том, что нужно с вашей стороны.
            </p>
          </div>
        </Reveal>

        <div className="mx-auto mt-10 max-w-2xl divide-y divide-navy-100 border-y border-navy-100">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={item.q} delay={Math.min(i * 0.04, 0.16)}>
                <div>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 py-4 text-left sm:py-5"
                  >
                    <span className="text-[0.9375rem] font-semibold tracking-[-0.015em] text-navy-900 sm:text-base">
                      {item.q}
                    </span>
                    <motion.span
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-mist text-navy-600"
                    >
                      <IconChevronDown className="h-4 w-4" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="pb-5 pr-10 text-sm leading-[1.65] text-navy-500 sm:text-[0.9375rem]">
                          {item.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={0.1}>
          <p className="mx-auto mt-8 max-w-xl text-center text-sm text-navy-500">
            Не нашли ответ?{' '}
            <a
              href={COMPANY.phoneHref}
              className="font-semibold text-brand-600 underline-offset-2 hover:underline"
            >
              Позвоните
            </a>{' '}
            или напишите в{' '}
            <a
              href={COMPANY.whatsapp}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand-600 underline-offset-2 hover:underline"
            >
              WhatsApp
            </a>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}
