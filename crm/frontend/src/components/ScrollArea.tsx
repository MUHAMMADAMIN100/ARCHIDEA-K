import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Прокручиваемая область, которая сама себя объясняет.
 *
 * Задача: человек должен видеть, что содержимое продолжается за краем, и
 * понимать, куда его тянуть, — БЕЗ подписей вроде «листайте вправо».
 * Работают два сигнала:
 *
 *   1. Край растворяется с той стороны, куда ещё есть куда крутить, и
 *      пропадает, когда прокрутили до упора. Так видно и «там есть ещё»,
 *      и «дальше некуда».
 *   2. Точки под областью — сколько всего экранов и на каком вы сейчас.
 *      Включаются только там, где элементы листаются по одному.
 *
 * Почему признаки ставятся прямо в DOM, а не через состояние React: событие
 * прокрутки приходит на каждый кадр, и setState на нём перерисовывал бы
 * доску воронки со всеми карточками по шестьдесят раз в секунду. Атрибут
 * меняется мимо React, а стиль подхватывает CSS (см. .scroll-edge).
 */

interface Props {
  children: ReactNode;
  /** Направление прокрутки. По умолчанию горизонтальное */
  axis?: 'x' | 'y';
  /** Классы внешней обёртки (на ней рисуются края) */
  className?: string;
  /** Классы самой прокручиваемой полосы */
  innerClassName?: string;
  /**
   * Цвет, в который растворяется край. Нужен, когда область лежит не на
   * белом: иначе градиент уходит в белый и виден полосой.
   */
  fadeBg?: string;
  /**
   * Сколько элементов листается по одному — под областью появятся точки.
   * Не задавайте для длинных списков: сорок точек читаются как мусор.
   */
  dotsCount?: number;
  /** Подпись области для читалок экрана */
  label?: string;
}

export function ScrollArea({
  children,
  axis = 'x',
  className = '',
  innerClassName = '',
  fadeBg,
  dotsCount,
  label,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dot, setDot] = useState(0);

  const sync = useCallback(() => {
    const box = scrollRef.current;
    const wrap = wrapRef.current;
    if (!box || !wrap) return;

    const horizontal = axis === 'x';
    const pos = horizontal ? box.scrollLeft : box.scrollTop;
    const size = horizontal ? box.clientWidth : box.clientHeight;
    const full = horizontal ? box.scrollWidth : box.scrollHeight;

    /*
     * Допуск в один пиксель обязателен: при дробном масштабе браузера
     * scrollLeft в конце равен, например, 372.5 при пределе 373, и без
     * допуска край не гас бы никогда.
     */
    const atStart = pos <= 1;
    const atEnd = pos + size >= full - 1;
    // области, которая целиком помещается, объяснять нечего
    const fits = full <= size + 1;

    wrap.setAttribute('data-at-start', String(fits || atStart));
    wrap.setAttribute('data-at-end', String(fits || atEnd));

    if (dotsCount && dotsCount > 1) {
      const step = full / dotsCount;
      const index = step > 0 ? Math.round(pos / step) : 0;
      setDot(Math.max(0, Math.min(dotsCount - 1, index)));
    }
  }, [axis, dotsCount]);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    sync();

    box.addEventListener('scroll', sync, { passive: true });
    /*
     * Размер меняется и без прокрутки: свернули боковое меню, повернули
     * телефон, догрузились карточки. Без наблюдателя край оставался бы
     * от прошлой раскладки.
     */
    const ro = new ResizeObserver(sync);
    ro.observe(box);
    if (box.firstElementChild) ro.observe(box.firstElementChild);

    return () => {
      box.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [sync, children]);

  const edgeClass = axis === 'x' ? 'scroll-edge-x' : 'scroll-edge-y';
  const overflow = axis === 'x' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto';

  return (
    <div>
      <div
        ref={wrapRef}
        className={`scroll-edge ${edgeClass} ${className}`}
        style={fadeBg ? ({ ['--fade-bg' as string]: fadeBg } as React.CSSProperties) : undefined}
        data-at-start="true"
        data-at-end="true"
      >
        <div
          ref={scrollRef}
          className={`${overflow} ${innerClassName}`}
          // область прокручивается с клавиатуры — иначе до неё не добраться без мыши
          tabIndex={0}
          role="group"
          aria-label={label}
        >
          {children}
        </div>
      </div>

      {dotsCount && dotsCount > 1 ? (
        <div className="mt-2 flex items-center justify-center gap-1.5" aria-hidden="true">
          {Array.from({ length: dotsCount }).map((_, i) => (
            <span key={i} className="swipe-dot" data-active={i === dot} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Признак «шапка оторвалась от начала списка» для .sticky-head.
 *
 * Ставит на элемент data-stuck, по которому CSS включает тень. Сама шапка
 * при этом остаётся обычным sticky-элементом — мы лишь отвечаем на вопрос
 * «под ней уже что-то проехало?».
 *
 * Через IntersectionObserver, а не по событию прокрутки: наблюдатель
 * срабатывает только в момент пересечения, а не на каждом кадре.
 */
export function useStuck<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const head = ref.current;
    const mark = sentinelRef.current;
    if (!head || !mark) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        head.setAttribute('data-stuck', String(!entry.isIntersecting));
      },
      { threshold: 0 },
    );
    io.observe(mark);
    return () => io.disconnect();
  }, []);

  return { ref, sentinelRef };
}

/**
 * Невидимая метка над прилипшей шапкой. Пока она видна — список в начале.
 * Ставится непосредственно перед элементом с .sticky-head.
 */
export function StuckSentinel({
  sentinelRef,
}: {
  sentinelRef: React.RefObject<HTMLDivElement>;
}) {
  return <div ref={sentinelRef} aria-hidden="true" className="h-px" />;
}
