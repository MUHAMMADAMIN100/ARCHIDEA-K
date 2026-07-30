import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Logo } from '../ui/Logo';
import { IconPhone } from '../ui/icons';
import { COMPANY } from '../../config/company';
import { scrollToId } from '../../lib/scroll';

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Над тёмным Hero — светлый текст; после скролла — белая шапка с тёмным текстом.
  const navLink = scrolled
    ? 'text-navy-600 hover:text-navy-900'
    : 'text-white hover:text-white/80';

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-navy-100 bg-white/90 text-navy-900 shadow-sm backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent text-white'
      }`}
    >
      <div className="container-px flex h-16 min-w-0 items-center justify-between gap-2">
        {/* на 320 px логотип в полный рост вместе с кнопкой звонка не влезал */}
        <Logo
          variant={scrolled ? 'blue' : 'white'}
          className="h-9 shrink-0 sm:h-12"
        />

        <nav className="hidden items-center gap-7 text-sm font-medium md:flex">
          {[
            ['О нас', 'about'],
            ['Услуги', 'tariffs'],
            ['Калькулятор', 'calculator'],
            ['Контакты', 'footer'],
          ].map(([label, id]) => (
            <button
              key={id}
              onClick={() => scrollToId(id)}
              className={`transition ${navLink}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <a
          href={COMPANY.phoneHref}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-all sm:gap-2 sm:px-4 sm:py-2 sm:text-sm ${
            scrolled
              ? 'bg-navy-500 text-white hover:bg-navy-600'
              : 'border border-white/25 bg-white/5 text-white backdrop-blur hover:bg-white/10'
          }`}
        >
          <IconPhone className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">{COMPANY.phone}</span>
          <span className="sm:hidden">Позвонить</span>
        </a>
      </div>
    </motion.header>
  );
}
