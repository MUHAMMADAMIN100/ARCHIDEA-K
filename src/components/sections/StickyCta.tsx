import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconPhone, IconWhatsapp } from '../ui/icons';
import { COMPANY } from '../../config/company';
import { scrollToId } from '../../lib/scroll';

/**
 * Нижняя sticky-панель только на телефоне.
 * Появляется после скролла hero, не перекрывает калькулятор в фокусе.
 */
export function StickyCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const calc = document.getElementById('calculator');
      let nearCalc = false;
      if (calc) {
        const r = calc.getBoundingClientRect();
        // прячем бар, когда калькулятор уже почти на экране
        nearCalc = r.top < window.innerHeight * 0.55;
      }
      setShow(y > 280 && !nearCalc);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-navy-100 bg-snow pb-[env(safe-area-inset-bottom)] shadow-pop md:hidden"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="container-px flex items-center gap-2 py-2.5">
            <a
              href={COMPANY.phoneHref}
              className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-navy-200 text-brand-600"
              aria-label="Позвонить"
            >
              <IconPhone className="h-5 w-5" />
            </a>
            <a
              href={COMPANY.whatsapp}
              target="_blank"
              rel="noreferrer"
              className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-navy-200 text-[#25D366]"
              aria-label="WhatsApp"
            >
              <IconWhatsapp className="h-5 w-5" />
            </a>
            <button
              type="button"
              onClick={() => scrollToId('request')}
              className="btn-primary min-w-0 flex-1 !py-2.5 text-sm"
            >
              Рассчитать стоимость
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
