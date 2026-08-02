import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalculatorStep } from './CalculatorStep';
import { SpecificsStep } from './SpecificsStep';
import { ContactsStep, samePhones } from './ContactsStep';
import { SuccessScreen } from './SuccessScreen';
import { Stepper } from './Stepper';
import { IconArrowLeft, IconArrowRight, IconCheck } from '../ui/icons';
import { calculatePrice } from '../../lib/calc';
import { PERSON_NAME_RE, formatPrice } from '../../lib/format';
import { submitOrderOptimistic, flushPendingOrders } from '../../lib/submit';
import { DEFAULTS } from '../../config/pricing';
import { usePricing } from '../../lib/tariffs';
import type {
  CalculatorState,
  ContactState,
  QuizState,
} from '../../types';

const STEP_TITLES = ['Параметры уборки', 'Детали заказа', 'Контакты'];

/** Сегодняшняя дата в формате YYYY-MM-DD (для min календаря) */
function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function QuizForm() {
  const [step, setStep] = useState(0); // 0,1,2
  const [done, setDone] = useState(false);
  // null — ответа от сервера ещё нет; false — заявка не дошла
  const [delivered, setDelivered] = useState<boolean | null>(null);

  // при загрузке — дослать заявки, которые не ушли в прошлый раз (сбой сети)
  useEffect(() => {
    flushPendingOrders();
  }, []);

  const pricing = usePricing(); // живые цены из CRM (с резервом)
  const [calc, setCalc] = useState<CalculatorState>({
    area: DEFAULTS.area,
    cleaningTypeId: DEFAULTS.cleaningTypeId,
    dirtLevel: DEFAULTS.dirtLevel,
    seats: DEFAULTS.seats,
    extras: {},
  });
  const [quiz, setQuiz] = useState<QuizState>({
    date: '',
    time: '',
    hasUtilities: '',
    access: '',
    comment: '',
  });
  const [contact, setContact] = useState<ContactState>({
    name: '',
    phone: '+992 ',
    phone2: '+992 ',
    address: '',
  });
  const [contactErrors, setContactErrors] = useState<
    Partial<Record<keyof ContactState, boolean>>
  >({});
  // Honeypot — скрытое поле-ловушка для ботов (люди его не видят и не заполняют)
  const [honeypot, setHoneypot] = useState('');

  const breakdown = useMemo(
    () => calculatePrice(calc, pricing.types, pricing.extras),
    [calc, pricing],
  );
  const minDate = useMemo(() => todayISO(), []);
  const isFurniture = calc.cleaningTypeId === 'furniture';

  // --- Валидация по шагам ---
  const canNext = useMemo(() => {
    if (step === 0)
      return (
        (isFurniture ? calc.seats > 0 : calc.area > 0) && breakdown.total > 0
      );
    if (step === 1)
      return (
        !!quiz.date && !!quiz.time && !!quiz.hasUtilities && !!quiz.access
      );
    return true;
  }, [step, calc.area, calc.seats, isFurniture, breakdown.total, quiz]);

  const validateContacts = () => {
    const errs: Partial<Record<keyof ContactState, boolean>> = {
      // имя — только буквы: раньше в заявку проходило «Тест клиент1й21»
      name: !PERSON_NAME_RE.test(contact.name.trim()),
      phone: contact.phone.replace(/\D/g, '').length < 12, // 992 + 9 цифр
      /*
       * Запасной номер обязателен и обязан отличаться от основного.
       * Без проверки на совпадение поле теряет смысл: люди копируют
       * первый номер, лишь бы форма пропустила дальше.
       */
      phone2:
        contact.phone2.replace(/\D/g, '').length < 12 ||
        samePhones(contact.phone, contact.phone2),
      address: contact.address.trim().length < 4,
    };
    setContactErrors(errs);
    return !Object.values(errs).some(Boolean);
  };

  const goNext = () => {
    if (!canNext) return;
    setStep((s) => Math.min(s + 1, 2));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleSubmit = () => {
    if (!validateContacts()) return;
    /*
     * Оптимистично: экран «Заявка отправлена» показываем сразу, отправка идёт
     * в фоне. Но результат обязательно дожидаемся: если заявка не дошла,
     * экран сменится на «позвоните нам». Раньше человек в любом случае видел
     * успех и ждал звонка, которого не будет, — обращения в CRM попросту нет.
     */
    submitOrderOptimistic(
      {
        calculator: calc,
        quiz,
        contact,
        total: breakdown.total,
        breakdown, // расчёт по живым ценам — для консистентного текста заявки
      },
      honeypot,
      (ok) => setDelivered(ok),
    );
    setDone(true);
  };

  if (done) {
    return (
      <SuccessScreen
        total={breakdown.total}
        name={contact.name}
        phone={contact.phone}
        delivered={delivered}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      {/*
        Левая часть — шаги формы (светлая карточка).

        min-w-0 обязателен. Ячейка сетки по умолчанию не даёт содержимому
        сжаться уже своей «естественной» ширины, и карточка раздувалась до
        361 пикселя из-за длинных названий доп. услуг. На экране 320 px она
        вылезала за правый край: обрезались подсказки под полями, текст
        согласия и сумма. Ноль разрешает ячейке сузиться, а длинные названия
        и без того укорачиваются многоточием.
      */}
      <div className="card-light min-w-0 p-6 text-navy-900 sm:p-8">
        {/* Honeypot — невидимая ловушка для ботов.
            Имя поля НЕ должно совпадать с реальным (company/email/name),
            иначе браузер автозаполнит его и заявка ошибочно уйдёт в спам. */}
        <input
          type="text"
          name="hp_contact_field"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          data-lpignore="true"
          data-1p-ignore=""
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />
        <Stepper current={step} titles={STEP_TITLES} />

        <div className="mt-7">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3 }}
            >
              {step === 0 && (
                <CalculatorStep state={calc} onChange={setCalc} pricing={pricing} />
              )}
              {step === 1 && (
                <SpecificsStep
                  state={quiz}
                  onChange={setQuiz}
                  minDate={minDate}
                />
              )}
              {step === 2 && (
                <ContactsStep
                  state={contact}
                  onChange={setContact}
                  errors={contactErrors}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/*
          Навигация.
          flex-wrap: на экране 320 px «Назад» и «Отправить заявку» в одну
          строку не помещались, и кнопка отправки на треть вылезала за край
          карточки. При нехватке места она уходит на свою строку.
        */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {step > 0 && (
            <button type="button" onClick={goBack} className="btn-outline-dark">
              <IconArrowLeft className="h-4 w-4" />
              Назад
            </button>
          )}
          {step < 2 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canNext}
              className="btn-primary ml-auto"
            >
              {step === 0 ? 'Оформить заявку' : 'Далее'}
              <IconArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="btn-primary ml-auto"
            >
              Отправить заявку
              <IconCheck className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Правая часть — «Итого» (тёмная панель, sticky) */}
      <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <div className="overflow-hidden rounded-3xl bg-navy-gradient text-white shadow-card">
          <div className="border-b border-white/10 bg-white/5 px-6 py-4">
            <h3 className="font-bold">Ваш расчёт</h3>
            <p className="text-xs text-white/50">Обновляется автоматически</p>
          </div>

          <div className="space-y-3 px-6 py-5 text-sm">
            <Row
              label={
                isFurniture
                  ? `Мягкая мебель · ${calc.seats} мест`
                  : `Уборка · ${calc.area} м²`
              }
              value={formatPrice(breakdown.base)}
            />
            {breakdown.extras.map((e) => (
              <Row key={e.title} label={e.title} value={formatPrice(e.sum)} muted />
            ))}
            {breakdown.extras.length === 0 && (
              <p className="text-xs text-white/40">Доп. услуги не выбраны</p>
            )}
          </div>

          <div className="border-t border-white/10 px-6 py-5">
            {/*
              На узком экране «Итого» и крупная сумма в одну строку не
              помещались: сумма переносилась и наезжала на подпись. Теперь
              при нехватке места сумма уходит на свою строку целиком.
            */}
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <span className="text-white/60">Итого</span>
              <motion.span
                key={breakdown.total}
                initial={{ scale: 0.9, opacity: 0.6 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="ml-auto whitespace-nowrap text-2xl font-extrabold text-white sm:text-3xl"
              >
                {formatPrice(breakdown.total)}
              </motion.span>
            </div>
          </div>
        </div>

        <ul className="mt-4 space-y-2 px-2 text-xs text-navy-500">
          {['Без предоплаты', 'Оплата после уборки', 'Можно отменить заранее'].map(
            (t) => (
              <li key={t} className="flex items-center gap-2">
                <IconCheck className="h-3.5 w-3.5 text-navy-600" />
                {t}
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={muted ? 'text-white/50' : 'text-white/80'}>{label}</span>
      <span className="shrink-0 font-semibold text-white">{value}</span>
    </div>
  );
}
