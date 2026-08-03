import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Logo } from '../ui/Logo';
import { IconPhone, IconMenu, IconClose } from '../ui/icons';
import { COMPANY } from '../../config/company';
import { scrollToId } from '../../lib/scroll';

export const NAV = [
  ['Как работаем', 'process'],
  ['О нас', 'about'],
  ['Услуги', 'tariffs'],
  ['Отзывы', 'reviews'],
  ['Вопросы', 'faq'],
  ['Калькулятор', 'calculator'],
] as const;

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    requestAnimationFrame(() => scrollToId(id));
  };

  return (
    <>
      <motion.header
        initial={{ y: -72, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className={`fixed inset-x-0 top-0 z-50 border-b bg-snow transition-[box-shadow,border-color] duration-160 ease-out ${
          scrolled ? 'border-navy-100 shadow-soft' : 'border-navy-100/80'
        }`}
      >
        <div className="container-px flex h-16 min-w-0 items-center justify-between gap-3 sm:h-[4.25rem]">
          <Logo variant="blue" className="h-8 shrink-0 sm:h-10" />

          <nav
            className="hidden items-center gap-6 text-[0.8125rem] font-medium tracking-[-0.01em] text-navy-600 md:flex lg:gap-7 lg:text-sm"
            aria-label="Основная навигация"
          >
            {NAV.map(([label, id]) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollToId(id)}
                className="transition-colors duration-120 ease-out hover:text-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <a
              href={COMPANY.phoneHref}
              className="hidden items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-navy-800 transition-colors hover:text-brand-600 lg:inline-flex"
            >
              <IconPhone className="h-4 w-4 text-brand-500" />
              <span className="tabular-nums">{COMPANY.phone}</span>
            </a>
            <button
              type="button"
              onClick={() => scrollToId('request')}
              className="press hidden rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold tracking-[-0.01em] text-white transition-colors hover:bg-brand-600 sm:inline-flex sm:px-5 sm:text-sm md:inline-flex"
            >
              Рассчитать
            </button>
            <button
              type="button"
              className="press flex h-10 w-10 items-center justify-center rounded-full text-navy-800 md:hidden"
              aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? (
                <IconClose className="h-5 w-5" />
              ) : (
                <IconMenu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              aria-label="Закрыть меню"
              className="fixed inset-0 z-[60] bg-navy-900/40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />
            <motion.nav
              aria-label="Мобильная навигация"
              className="fixed inset-x-0 top-16 z-[70] border-b border-navy-100 bg-snow shadow-pop md:hidden sm:top-[4.25rem]"
              initial={{ y: -12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <ul className="container-px py-3">
                {NAV.map(([label, id]) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => go(id)}
                      className="flex w-full items-center justify-between border-b border-navy-50 py-3.5 text-left text-[0.9375rem] font-medium tracking-[-0.01em] text-navy-800 last:border-0"
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="container-px flex flex-col gap-2 border-t border-navy-100 py-4">
                <a href={COMPANY.phoneHref} className="btn-primary w-full">
                  <IconPhone className="h-4 w-4" />
                  <span className="tabular-nums">{COMPANY.phone}</span>
                </a>
                <a
                  href={COMPANY.whatsapp}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-outline-dark w-full"
                >
                  WhatsApp
                </a>
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
