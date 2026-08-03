import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const AUTO_MS = 5000;
const RESUME_MS = 8000;

/**
 * Мобильная карусель (до md):
 * — карточка чуть уже экрана → виден край следующей (peek)
 * — gap между карточками
 * — автолистание каждые 5 с, цикл с первой
 * — пауза при касании/свайпе, затем снова авто
 * На md+ — обычная сетка.
 */
export function MobileHScroll({
  children,
  count,
  gridClass,
  ariaLabel,
}: {
  children: ReactNode[];
  count: number;
  gridClass: string;
  ariaLabel: string;
}) {
  const reduce = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pauseUntilRef = useRef(0);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 767px)').matches
      : false,
  );
  /* ключ, чтобы CSS-прогресс точки перезапускался на каждом слайде */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const goTo = useCallback(
    (index: number, smooth = true) => {
      const el = scrollerRef.current;
      if (!el) return;
      const i = ((index % count) + count) % count;
      const child = el.children[i] as HTMLElement | undefined;
      if (!child) return;
      const left = child.offsetLeft - el.clientLeft;
      el.scrollTo({
        left,
        behavior: smooth && !reduce ? 'smooth' : 'auto',
      });
      setActive(i);
      setTick((t) => t + 1);
    },
    [count, reduce],
  );

  const syncFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || count < 1) return;
    const center = el.scrollLeft + el.clientWidth * 0.35;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      const mid = child.offsetLeft + child.offsetWidth / 2;
      const d = Math.abs(mid - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setActive((prev) => {
      if (prev !== best) setTick((t) => t + 1);
      return best;
    });
  }, [count]);

  useEffect(() => {
    if (!isMobile) return;
    const el = scrollerRef.current;
    if (!el) return;
    syncFromScroll();
    el.addEventListener('scroll', syncFromScroll, { passive: true });
    window.addEventListener('resize', syncFromScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', syncFromScroll);
      window.removeEventListener('resize', syncFromScroll);
    };
  }, [isMobile, syncFromScroll]);

  /* Пауза автоскролла при взаимодействии */
  useEffect(() => {
    if (!isMobile) return;
    const el = scrollerRef.current;
    if (!el) return;
    const pause = () => {
      pauseUntilRef.current = Date.now() + RESUME_MS;
    };
    el.addEventListener('pointerdown', pause, { passive: true });
    el.addEventListener('touchstart', pause, { passive: true });
    el.addEventListener('wheel', pause, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', pause);
      el.removeEventListener('touchstart', pause);
      el.removeEventListener('wheel', pause);
    };
  }, [isMobile]);

  /* Автолистание каждые 5 с → дальше → после последней снова первая */
  useEffect(() => {
    if (!isMobile || count <= 1) return;
    const id = window.setInterval(() => {
      if (Date.now() < pauseUntilRef.current) return;
      const el = scrollerRef.current;
      if (!el) return;
      /* не листаем, если карусель вне экрана */
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (rect.bottom < 40 || rect.top > vh - 40) return;
      goTo(activeRef.current + 1, !reduce);
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [isMobile, count, reduce, goTo]);

  if (!isMobile) {
    return <div className={gridClass}>{children}</div>;
  }

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        role="region"
        aria-label={ariaLabel}
        aria-roledescription="карусель"
        className="mobile-hscroll -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:gap-3.5 sm:px-6"
      >
        {children.map((child, i) => {
          const isActive = i === active;
          return (
            <motion.div
              key={i}
              className="mobile-hscroll-item shrink-0"
              initial={reduce ? false : { opacity: 0, y: 20 }}
              whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{
                duration: 0.55,
                delay: Math.min(i * 0.06, 0.18),
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <motion.div
                className="h-full"
                animate={
                  reduce
                    ? undefined
                    : {
                        scale: isActive ? 1 : 0.97,
                        opacity: isActive ? 1 : 0.88,
                      }
                }
                transition={{
                  type: 'spring',
                  stiffness: 280,
                  damping: 28,
                }}
                whileTap={reduce ? undefined : { scale: 0.985 }}
              >
                {child}
              </motion.div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col items-center gap-2.5">
        <div
          className="flex items-center gap-1.5"
          role="tablist"
          aria-label="Слайды"
        >
          {Array.from({ length: count }).map((_, i) => {
            const on = i === active;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={`Слайд ${i + 1}`}
                onClick={() => {
                  pauseUntilRef.current = Date.now() + RESUME_MS;
                  goTo(i);
                }}
                className="relative h-1.5 overflow-hidden rounded-full bg-navy-200 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: on ? 28 : 6 }}
              >
                {on && !reduce && (
                  <span
                    key={tick}
                    className="mobile-hscroll-progress absolute inset-y-0 left-0 rounded-full bg-brand-500"
                  />
                )}
                {on && reduce && (
                  <span className="absolute inset-0 rounded-full bg-brand-500" />
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[0.6875rem] font-medium tracking-wide text-navy-400 tabular-nums">
          {active + 1} <span className="text-navy-300">/</span> {count}
        </p>
      </div>
    </div>
  );
}
