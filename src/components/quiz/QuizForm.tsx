import { useEffect, useMemo, useRef, useState } from 'react';
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

const STEP_TITLES = ['Параметры', 'Детали', 'Контакты'];

function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function QuizForm() {
  const doneRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [delivered, setDelivered] = useState<boolean | null>(null);

  useEffect(() => {
    flushPendingOrders();
  }, []);

  const pricing = usePricing();
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
  const [honeypot, setHoneypot] = useState('');

  const breakdown = useMemo(
    () => calculatePrice(calc, pricing.types, pricing.extras),
    [calc, pricing],
  );
  const minDate = useMemo(() => todayISO(), []);
  const isFurniture = calc.cleaningTypeId === 'furniture';
  const selectedType = pricing.types.find((t) => t.id === calc.cleaningTypeId);

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
      name: !PERSON_NAME_RE.test(contact.name.trim()),
      phone: contact.phone.replace(/\D/g, '').length < 12,
      phone2:
        contact.phone2.replace(/\D/g, '').length > 3 &&
        (contact.phone2.replace(/\D/g, '').length < 12 ||
          samePhones(contact.phone, contact.phone2)),
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
    submitOrderOptimistic(
      {
        calculator: calc,
        quiz,
        contact,
        total: breakdown.total,
        breakdown,
      },
      honeypot,
      (ok) => setDelivered(ok),
    );
    setDone(true);
  };

  useEffect(() => {
    if (!done) return;
    const el = doneRef.current;
    if (!el) return;
    const tall = el.getBoundingClientRect().height > window.innerHeight;
    el.scrollIntoView({ behavior: 'smooth', block: tall ? 'start' : 'center' });
  }, [done]);

  if (done) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center sm:min-h-[90vh]">
        <div ref={doneRef} className="w-full">
          <SuccessScreen
            total={breakdown.total}
            name={contact.name}
            phone={contact.phone}
            delivered={delivered}
          />
        </div>
      </div>
    );
  }

  const summaryLines = (
    <>
      <Row
        label={
          isFurniture
            ? `${selectedType?.title ?? 'Мебель'} · ${calc.seats} мест`
            : `${selectedType?.title ?? 'Уборка'} · ${calc.area} м²`
        }
        value={formatPrice(breakdown.base)}
      />
      {breakdown.extras.map((e) => (
        <Row key={e.title} label={e.title} value={formatPrice(e.sum)} muted />
      ))}
      {breakdown.extras.length === 0 && (
        <p className="text-xs text-white/40">Без доп. услуг</p>
      )}
    </>
  );

  const nextLabel =
    step === 0 ? 'Далее' : step === 1 ? 'Далее' : 'Отправить';

  return (
    <div className="quiz-layout grid items-start gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(15rem,0.95fr)] md:gap-5 lg:gap-6">
      {/* Итого сверху на mobile/tablet — не нужно скроллить вниз */}
      <aside className="order-1 min-w-0 md:order-2 md:sticky md:top-20 md:self-start lg:top-24">
        <div className="overflow-hidden rounded-xl border border-navy-800 bg-ink text-white shadow-card sm:rounded-2xl">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
            <h3 className="quiz-sum-title">Ваш расчёт</h3>
            <motion.span
              key={breakdown.total}
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 1 }}
              className="text-lg font-bold tabular-nums tracking-[-0.02em] md:hidden"
            >
              {formatPrice(breakdown.total)}
            </motion.span>
          </div>

          <div className="quiz-sum-row space-y-2 border-t border-white/10 px-4 py-3 sm:space-y-2.5 sm:px-5 sm:py-4">
            {summaryLines}
          </div>

          <div className="border-t border-white/10 bg-white/[0.04] px-4 py-3.5 sm:px-5 sm:py-5">
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <span className="quiz-sum-row text-white/55">Итого</span>
              <motion.span
                key={`t-${breakdown.total}`}
                initial={{ opacity: 0.5, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="quiz-sum-total text-xl sm:text-2xl"
              >
                {formatPrice(breakdown.total)}
              </motion.span>
            </div>
            <p className="quiz-sum-note mt-1.5 hidden sm:block">
              Предварительно. Менеджер подтвердит после заявки.
            </p>
          </div>
        </div>

        <ul className="quiz-trust mt-3 hidden space-y-1.5 px-0.5 md:block">
          {[
            'Без предоплаты',
            'Оплата после уборки',
            'Можно отменить заранее',
          ].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <IconCheck className="h-3.5 w-3.5 shrink-0 text-brand-500" />
              {t}
            </li>
          ))}
        </ul>
      </aside>

      {/* Форма */}
      <div className="order-2 relative min-w-0 overflow-hidden rounded-xl border border-navy-100 bg-white shadow-card sm:rounded-2xl md:order-1">
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

        <div className="border-b border-navy-100 px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
          <Stepper current={step} titles={STEP_TITLES} />
        </div>

        <div className="quiz-form-body px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {step === 0 && (
                <CalculatorStep
                  state={calc}
                  onChange={setCalc}
                  pricing={pricing}
                />
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

        {/* Футер: sticky на mobile чтобы CTA и итог всегда видны */}
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-navy-100 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] sm:static sm:gap-3 sm:bg-mist/40 sm:px-6 sm:py-4 sm:shadow-none lg:px-8">
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="btn-outline-dark !px-4 !py-2.5 text-sm"
            >
              <IconArrowLeft className="h-4 w-4" />
              <span className="hidden xs:inline sm:inline">Назад</span>
            </button>
          )}
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none sm:gap-3">
            <div className="min-w-0 text-right md:hidden">
              <p className="text-[0.625rem] text-navy-400">Итого</p>
              <p className="truncate text-sm font-bold tabular-nums text-navy-900">
                {formatPrice(breakdown.total)}
              </p>
            </div>
            {step < 2 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!canNext}
                className="btn-primary !px-5 !py-2.5 text-sm"
              >
                {nextLabel}
                <IconArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                className="btn-primary !px-5 !py-2.5 text-sm"
              >
                Отправить
                <IconCheck className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
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
    <div className="quiz-sum-row flex items-start justify-between gap-3">
      <span className={`min-w-0 break-words ${muted ? 'text-white/45' : 'text-white/75'}`}>
        {label}
      </span>
      <span className="shrink-0 font-semibold tabular-nums text-white">
        {value}
      </span>
    </div>
  );
}
