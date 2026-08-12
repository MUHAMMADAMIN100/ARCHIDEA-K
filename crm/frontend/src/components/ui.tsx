import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, X } from 'lucide-react';

/** Поле ввода пароля с кнопкой «показать/скрыть» */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete = 'off',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        className="input pr-11"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-navy-600 transition-colors hover:text-navy-700"
        aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
      >
        {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
      </button>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-navy-200 border-t-navy-700" />
    </div>
  );
}

/**
 * Заглушка загрузки: серая разметка будущего содержимого.
 *
 * Крутящийся кружок ничего не сообщает и оставляет экран пустым, а когда
 * данные приходят — вёрстка прыгает с нуля до полной высоты. Заглушка
 * занимает то же место, что и настоящие данные, поэтому появление проходит
 * незаметно, а ожидание subjective кажется короче.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Заглушка списка: несколько строк-карточек одинаковой высоты */
export function SkeletonList({
  rows = 5,
  className = '',
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={`space-y-2 ${className}`}
      role="status"
      aria-label="Загрузка"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-md" />
      ))}
    </div>
  );
}

/** Заглушка сетки карточек — для дашборда и разделов с боксами */
export function SkeletonCards({
  count = 4,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${className}`}
      role="status"
      aria-label="Загрузка"
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-md" />
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  back = true,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Своя кнопка возврата уже есть на странице — не рисуем вторую */
  back?: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  /*
   * Возврат на шаг назад есть на каждом экране, кроме дашборда: он и есть
   * начало пути. Раньше кнопка стояла только в карточках — из «Задач» или
   * «Финансов» вернуться было нечем, кроме бокового меню, а на телефоне
   * его ещё надо открыть.
   *
   * Открыли раздел по прямой ссылке (из уведомления, из письма) — истории
   * в этой вкладке нет, и «назад» увело бы на чужой сайт. Такой случай
   * различаем по счётчику переходов роутера и уводим на дашборд.
   */
  const showBack = back && pathname !== '/';
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  };

  /*
   * Заголовок и действия — в одной строке.
   *
   * Подзаголовок остался только там, где он объясняет цифры (дашборд,
   * аналитика, история изменений). На остальных экранах он отодвигал
   * кнопки «Добавить» и «Экспорт» на строку ниже, а сам ничего не добавлял
   * к названию раздела.
   */
  return (
    <div className="mb-5">
      {showBack && (
        <button
          type="button"
          onClick={goBack}
          className="press mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-navy-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-navy-600">{subtitle}</p>}
        </div>
        {action && (
          <div className="flex flex-wrap items-center gap-2">{action}</div>
        )}
      </div>
    </div>
  );
}

export function Badge({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-navy-200 bg-white/60 py-12 text-center text-sm text-navy-600">
      {text}
    </div>
  );
}

/** Ошибка загрузки с кнопкой повтора (вместо бесконечного спиннера). */
export function ErrorState({
  /*
   * По умолчанию не утверждаем, что виноват интернет: чаще всего сюда
   * приходят с ответом сервера («не найдено», «нет доступа»), и ложная
   * подсказка уводила человека искать неполадки со связью.
   */
  text = 'Не удалось загрузить данные',
  onRetry,
}: {
  text?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="max-w-xs text-sm text-navy-600">{text}</div>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary">
          Повторить
        </button>
      )}
    </div>
  );
}

/** Сколько модалок сейчас открыто — прокрутку страницы отпускаем на последней */
let lockCount = 0;

/*
 * «Назад» закрывает окно, а не уводит со страницы.
 *
 * Окно живёт ПОВЕРХ страницы, и раньше кнопка «назад» о нём не знала: человек
 * открывал карточку заказа из воронки, жал «назад» — и вылетал со всей
 * воронки, теряя и карточку, и колонку, до которой долистал.
 *
 * Как устроено: каждое открытое окно кладёт в историю браузера свою запись
 * (адрес не меняется — только метка). «Назад» снимает эту запись, мы это
 * слышим и закрываем верхнее окно. Если окно закрыли крестиком или после
 * сохранения — сами снимаем свою запись, чтобы она не осталась лишним шагом.
 * Вложенные окна закрываются по одному: запись у каждого своя.
 */
const modalStack: { id: number; close: () => void }[] = [];
let modalSeq = 0;
/** Сколько ближайших событий «назад» — наши собственные, а не человека */
let ignorePops = 0;

function topModalId(): number | null {
  const state = window.history.state as { __modal?: number } | null;
  return typeof state?.__modal === 'number' ? state.__modal : null;
}

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops -= 1;
    return;
  }
  const top = modalStack[modalStack.length - 1];
  if (top) top.close();
});

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  headerAction,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Кнопка слева от крестика — например, карандаш «править» */
  headerAction?: ReactNode;
}) {
  /*
   * Закрытие по «назад» зовёт актуальный onClose через ref: иначе пришлось бы
   * пересоздавать запись в истории при каждом ререндере родителя.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    /*
     * Считаем открытые окна: модалка может открыться из модалки, и раньше
     * закрытие вложенной снимало блокировку прокрутки, хотя внешняя ещё висела
     * — страница за окном начинала ездить.
     */
    lockCount += 1;
    document.body.style.overflow = 'hidden';

    const id = ++modalSeq;
    const entry = { id, close: () => onCloseRef.current() };
    modalStack.push(entry);
    /*
     * Свои поля истории роутера сохраняем: в них живёт счётчик переходов,
     * по которому кнопка «Назад» на страницах решает, есть ли куда возвращаться.
     */
    window.history.pushState(
      { ...(window.history.state as object | null), __modal: id },
      '',
    );

    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = '';

      const at = modalStack.indexOf(entry);
      if (at >= 0) modalStack.splice(at, 1);
      /*
       * Окно закрыли не кнопкой «назад» (крестик, клик мимо, после
       * сохранения) — запись в истории ещё висит. Снимаем её сами, пометив,
       * что это НАШ шаг назад: иначе он закрыл бы следующее окно.
       *
       * Если же запись уже не сверху (человек ушёл по ссылке из окна или
       * закрыл его кнопкой «назад») — историю не трогаем.
       */
      if (topModalId() === id) {
        ignorePops += 1;
        window.history.back();
      }
    };
  }, [open]);

  if (!open) return null;

  /*
   * Через портал в body — обязательно.
   *
   * Раньше у подложки было размытие, и оно делало её точкой отсчёта для
   * вложенных position: fixed. Из-за этого модалка, открытая ИЗ другой модалки
   * («Напомнить о звонке» из карточки заказа), считала «верх экрана» от
   * прокрученного родителя и всплывала за пределами видимой части — человеку
   * приходилось скроллить наверх, чтобы её найти. Портал уводит разметку в
   * body, где отсчёт снова идёт от окна.
   */
  return createPortal(
    <div
      // items-center: окно всегда в центре экрана, как бы страница ни была прокручена
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-navy-950/35 p-3 sm:p-8"
      onClick={onClose}
      /*
       * Esc закрывает окно — как везде. Крестик и клик по фону работали,
       * а привычная клавиша нет: люди жали Esc и решали, что окно зависло.
       * tabIndex нужен, чтобы контейнер мог принять нажатие клавиши, когда
       * фокус не в поле ввода.
       */
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      tabIndex={-1}
    >
      {/*
       * Длинная форма прокручивается ВНУТРИ окна, а не уводит вниз весь оверлей
       * — иначе центрирование теряется, как только содержимое выше экрана.
       */}
      <div
        /*
         * На телефоне отступы окна меньше: при 24px с каждой стороны плюс
         * поля оверлея содержимому оставалось меньше 300px, и подписи
         * («Услуга», «Площадь, м²») срезались краем карточки.
         */
        /*
         * shadow-modal — верхний уровень высоты: окно перекрывает всё.
         * animate-pop-in — приходит на место снизу и чуть увеличиваясь,
         * за 200 мс. Без этого окно возникало рывком, и глаз не успевал
         * понять, что изменилось на экране.
         */
        className={`card flex max-h-[92vh] w-full animate-pop-in flex-col shadow-modal ${wide ? 'max-w-2xl' : 'max-w-md'} p-4 sm:max-h-[90vh] sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-lg font-bold text-navy-900">{title}</h2>
          <div className="flex shrink-0 items-center gap-1">
            {headerAction}
            <button
              onClick={onClose}
              className="press rounded-lg p-1 text-navy-600 transition-colors hover:bg-navy-50 hover:text-navy-700"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {/*
         * Содержимое прокручивается внутри окна. Небольшой отступ сверху
         * нужен, чтобы прокрученная строка не прилипала к заголовку и не
         * выглядела срезанной по верхней кромке.
         *
         * Полоса прокрутки вынесена в поле карточки: отрицательный отступ
         * справа расширяет область прокрутки до края окна, а такой же
         * внутренний отступ возвращает содержимое на прежнее место. В итоге
         * между полосой и полями появляется просвет — раньше она шла впритык
         * и упиралась прямо в кнопки «Отмена» и «Создать».
         */}
        <div className="modal-scroll -mr-2 min-h-0 flex-1 overflow-y-auto pb-1 pr-2 pt-1 sm:-mr-3 sm:pr-3">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
