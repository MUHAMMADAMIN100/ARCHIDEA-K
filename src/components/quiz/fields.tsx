import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

/** Подпись над полем */
export function FieldLabel({
  children,
  required,
  hint,
}: {
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="mb-2">
      <label className="quiz-label block">
        {children}
        {required && <span className="ml-0.5 text-brand-500">*</span>}
      </label>
      {hint && <p className="quiz-hint mt-0.5">{hint}</p>}
    </div>
  );
}

const inputBase =
  'quiz-input w-full rounded-lg border border-navy-200 bg-white px-4 py-3 ' +
  'placeholder:text-navy-300 transition-colors duration-120 ease-out ' +
  'focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

export function TextInput({
  invalid,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      className={`${inputBase} ${invalid ? '!border-red-400 !ring-red-100' : ''} ${className}`}
    />
  );
}

export function TextArea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} resize-none ${className}`} />;
}

/** Карточка-выбор */
export function OptionCard({
  active,
  onClick,
  title,
  subtitle,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-120 ease-out sm:gap-3 sm:px-3.5 sm:py-3 ${
        active
          ? 'border-brand-500 bg-brand-50 shadow-soft'
          : 'border-navy-200 bg-white hover:border-navy-300 hover:bg-mist/60'
      }`}
    >
      {icon && (
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
            active ? 'bg-brand-500 text-white' : 'bg-mist text-navy-600'
          }`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="quiz-option-title block break-words">{title}</span>
        {subtitle && (
          <span className="quiz-option-meta mt-0.5 block">{subtitle}</span>
        )}
      </span>
      <span
        className={`mt-0.5 ml-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-120 ease-out ${
          active ? 'border-brand-500 bg-brand-500' : 'border-navy-300'
        }`}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
    </button>
  );
}

/** Chip пресетов */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`quiz-chip press rounded-md px-3 py-1.5 transition-colors duration-120 ease-out ${
        active
          ? 'bg-brand-500 text-white'
          : 'bg-mist text-navy-600 hover:bg-navy-100'
      }`}
    >
      {children}
    </button>
  );
}
