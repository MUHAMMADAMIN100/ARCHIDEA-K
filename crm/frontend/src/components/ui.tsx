import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, X } from 'lucide-react';

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

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy-600">{subtitle}</p>}
      </div>
      {action}
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
  text = 'Не удалось загрузить данные. Проверьте интернет.',
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

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    /*
     * Считаем открытые окна: модалка может открыться из модалки, и раньше
     * закрытие вложенной снимало блокировку прокрутки, хотя внешняя ещё висела
     * — страница за окном начинала ездить.
     */
    lockCount += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  /*
   * Через портал в body — обязательно.
   *
   * У оверлея есть backdrop-blur, а размытие делает элемент точкой отсчёта для
   * вложенных position: fixed. Из-за этого модалка, открытая ИЗ другой модалки
   * («Напомнить о звонке» из карточки заказа), считала «верх экрана» от
   * прокрученного родителя и всплывала за пределами видимой части — человеку
   * приходилось скроллить наверх, чтобы её найти. Портал уводит разметку в
   * body, где отсчёт снова идёт от окна.
   */
  return createPortal(
    <div
      // items-center: окно всегда в центре экрана, как бы страница ни была прокручена
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/10 p-4 backdrop-blur-md sm:p-8"
      onClick={onClose}
    >
      {/*
       * Длинная форма прокручивается ВНУТРИ окна, а не уводит вниз весь оверлей
       * — иначе центрирование теряется, как только содержимое выше экрана.
       */}
      <div
        className={`card flex max-h-[90vh] w-full flex-col ${wide ? 'max-w-2xl' : 'max-w-md'} p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-bold text-navy-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-navy-600 hover:bg-navy-50 hover:text-navy-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
