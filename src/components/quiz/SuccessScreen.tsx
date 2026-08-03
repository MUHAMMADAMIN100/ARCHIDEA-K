import { IconCheck, IconPhone } from '../ui/icons';
import { formatPrice } from '../../lib/format';
import { COMPANY } from '../../config/company';

interface Props {
  total: number;
  name: string;
  phone: string;
  /**
   * Дошла ли заявка до CRM. null — ответа ещё нет (отправка идёт в фоне).
   *
   * Пока экран показывал «Заявка отправлена» безусловно, недоставленная
   * заявка выглядела для человека доставленной: он ждал звонка, которого
   * никто не собирался делать, потому что в CRM обращения не было.
   */
  delivered?: boolean | null;
}

export function SuccessScreen({ total, name, phone, delivered = null }: Props) {
  if (delivered === false) return <FailureScreen name={name} />;

  /*
    Экран приходит на место снизу за 200 мс — этого хватает, чтобы человек
    заметил подмену формы ответом. Галочка отдельно больше не пружинит:
    два разных движения подряд на одном экране читались как праздник, а не
    как подтверждение.
  */
  return (
    <div className="card-light animate-pop-in mx-auto max-w-xl p-8 text-center text-navy-900 sm:p-12">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-brand-50">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500">
          <IconCheck className="h-8 w-8 text-white" />
        </span>
      </div>

      <h3 className="mt-6 text-2xl font-bold tracking-[-0.025em] sm:text-3xl">
        Заявка отправлена!
      </h3>
      <p className="mt-3 text-[0.9375rem] leading-[1.65] text-navy-600">
        Спасибо{name ? `, ${name}` : ''}! Мы получили вашу заявку на сумму{' '}
        <span className="font-semibold text-navy-800">{formatPrice(total)}</span>
        . Менеджер свяжется с вами в ближайшее время для подтверждения.
      </p>

      <div className="mt-6 rounded-xl border border-navy-100 bg-mist px-5 py-4 text-sm text-navy-600">
        Мы позвоним на номер{' '}
        <span className="font-semibold text-navy-900">{phone}</span>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a href={COMPANY.whatsapp} target="_blank" className="btn-primary">
          Написать в WhatsApp
        </a>
        <a href={COMPANY.phoneHref} className="btn-outline-dark">
          <IconPhone className="h-4 w-4" />
          {COMPANY.phone}
        </a>
      </div>

      <p className="mt-6 text-xs text-navy-400">{COMPANY.workingHours}</p>
    </div>
  );
}

/**
 * Заявку доставить не удалось.
 *
 * Честно говорим об этом и сразу даём способ связаться: молчаливая «успешная»
 * отправка стоит компании заказа, а человеку — впустую потраченного дня
 * ожидания. Заявка при этом остаётся в очереди и уйдёт сама, если связь
 * восстановится, — поэтому предлагаем позвонить, а не «отправить ещё раз».
 */
function FailureScreen({ name }: { name: string }) {
  return (
    <div className="card-light animate-pop-in mx-auto max-w-xl p-8 text-center text-navy-900 sm:p-12">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500">
          <IconPhone className="h-7 w-7 text-white" />
        </span>
      </div>

      <h3 className="mt-6 text-2xl font-bold tracking-[-0.025em] sm:text-3xl">
        Не удалось отправить заявку
      </h3>
      <p className="mt-3 text-[0.9375rem] leading-[1.65] text-navy-600">
        {name ? `${name}, с` : 'С'}вязь с нашей системой прервалась, и заявка
        не дошла. Позвоните или напишите — примем заказ прямо сейчас и
        посчитаем стоимость вместе с вами.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a href={COMPANY.phoneHref} className="btn-primary">
          <IconPhone className="h-4 w-4" />
          {COMPANY.phone}
        </a>
        <a href={COMPANY.whatsapp} target="_blank" className="btn-outline-dark">
          Написать в WhatsApp
        </a>
      </div>

      <p className="mt-6 text-xs text-navy-400">{COMPANY.workingHours}</p>
    </div>
  );
}
