import { Logo } from '../ui/Logo';
import {
  IconPhone,
  IconMapPin,
  IconClock,
  IconTelegram,
  IconWhatsapp,
  IconInstagram,
} from '../ui/icons';
import { COMPANY } from '../../config/company';
import { scrollToId } from '../../lib/scroll';

const SOCIALS = [
  {
    href: COMPANY.telegram,
    icon: IconTelegram,
    label: COMPANY.telegramHandle, // @archideacleaning
  },
  { href: COMPANY.whatsapp, icon: IconWhatsapp, label: 'WhatsApp' },
  { href: COMPANY.instagram, icon: IconInstagram, label: 'Instagram' },
] as const;

const NAV = [
  ['Как работаем', 'process'],
  ['О нас', 'about'],
  ['Услуги', 'tariffs'],
  ['Отзывы', 'reviews'],
  ['Вопросы', 'faq'],
  ['Калькулятор', 'calculator'],
] as const;

export function Footer() {
  return (
    <footer id="footer" className="bg-ink text-white">
      <div className="border-b border-white/10">
        <div className="container-px flex flex-col items-start justify-between gap-6 py-11 sm:flex-row sm:items-center sm:py-12">
          <div>
            <h3 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">
              Готовы к чистому дому?
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-white/50">
              Посчитайте стоимость онлайн или позвоните прямо сейчас
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => scrollToId('request')} className="btn-primary">
              Рассчитать стоимость
            </button>
            <a href={COMPANY.phoneHref} className="btn-white">
              <IconPhone className="h-4 w-4" />
              <span className="tabular-nums">{COMPANY.phone}</span>
            </a>
          </div>
        </div>
      </div>

      <div className="container-px py-14 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr_1fr] lg:gap-12">
          <div>
            <Logo variant="white" />
            <p className="mt-4 max-w-xs text-sm leading-[1.65] text-white/50">
              Профессиональный клининг в {COMPANY.city}. Чистота, которой можно
              доверять — для дома и офиса.
            </p>
            <div className="mt-6 flex gap-2">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.label}
                  title={s.label}
                  className="press flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/55 transition-colors hover:border-white/25 hover:text-white"
                >
                  <s.icon className="h-[18px] w-[18px]" />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-white/35">
              Разделы
            </h4>
            <ul className="mt-4 space-y-3 text-sm text-white/60">
              {NAV.map(([label, id]) => (
                <li key={id}>
                  <button
                    onClick={() => scrollToId(id)}
                    className="tracking-[-0.01em] transition-colors hover:text-white"
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-white/35">
              Контакты
            </h4>
            <ul className="mt-4 space-y-3.5 text-sm text-white/60">
              {COMPANY.phones.map((p) => (
                <li key={p.href}>
                  <a
                    href={p.href}
                    className="flex items-center gap-2.5 tracking-[-0.01em] transition-colors hover:text-white"
                  >
                    <IconPhone className="h-4 w-4 shrink-0 text-brand-400" />
                    <span className="tabular-nums">{p.display}</span>
                  </a>
                </li>
              ))}
              <li>
                <a
                  href={COMPANY.telegram}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 tracking-[-0.01em] transition-colors hover:text-white"
                >
                  <IconTelegram className="h-4 w-4 shrink-0 text-brand-400" />
                  {COMPANY.telegramHandle}
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <IconMapPin className="h-4 w-4 shrink-0 text-brand-400" />
                {COMPANY.address}
              </li>
              <li className="flex items-center gap-2.5">
                <IconClock className="h-4 w-4 shrink-0 text-brand-400" />
                {COMPANY.workingHours}
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs leading-relaxed text-white/30 sm:flex-row">
          <div className="flex flex-col items-center gap-1.5 sm:items-start">
            <p>
              © {new Date().getFullYear()} {COMPANY.name}. Все права защищены.
            </p>
            <a
              href="https://www.instagram.com/webrand.tj/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-white/45 transition-colors hover:text-white/80"
            >
              Разработано компанией WeBrand
            </a>
          </div>
          <p className="text-center sm:text-right">
            <a
              href="mailto:info@arhydeya.tj"
              className="transition-colors hover:text-white/60"
            >
              Политика конфиденциальности
            </a>
            {' · '}
            <a
              href="mailto:info@arhydeya.tj"
              className="transition-colors hover:text-white/60"
            >
              Договор оферты
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
