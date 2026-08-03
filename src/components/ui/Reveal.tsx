import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** Задержка появления, сек */
  delay?: number;
  /** Направление въезда */
  y?: number;
  className?: string;
}

/**
 * Обёртка для анимации появления при скролле.
 * Элемент плавно въезжает снизу и проявляется, когда попадает во вьюпорт.
 */
export function Reveal({ children, delay = 0, y = 14, className }: RevealProps) {
  /*
   * Настройку «меньше движения» index.css гасит только для своих переходов:
   * framer-motion пишет сдвиг инлайном, и CSS-правило до него не достаёт.
   * Поэтому спрашиваем настройку явно и оставляем одно проявление —
   * содержимое обязано показаться в любом случае.
   */
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-48px', amount: 0.2 }}
      transition={{
        duration: reduce ? 0.12 : 0.7,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
