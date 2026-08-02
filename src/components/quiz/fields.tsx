import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

/** Подпись над полем */
export function FieldLabel({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="mb-2 block text-sm font-medium text-navy-700">
      {children}
      {required && <span className="ml-0.5 text-accent">*</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-2xl border border-navy-200 bg-white px-4 py-3 text-navy-900 ' +
  'placeholder:text-navy-300 transition-colors focus:border-navy-600 ' +
  'focus:outline-none focus:ring-2 focus:ring-navy-200';

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

/** Универсальная карточка-переключатель (radio-подобная) */
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
      className={`press flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-[background-color,border-color,box-shadow,transform] duration-120 ease-out ${
        active
          ? 'border-navy-700 bg-navy-50 ring-1 ring-navy-300'
          : 'border-navy-200 bg-white hover:border-navy-400 hover:bg-navy-50'
      }`}
    >
      {icon && (
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
            active ? 'bg-brand-500 text-white' : 'bg-navy-100 text-navy-600'
          }`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block break-words font-semibold leading-tight text-navy-900">
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block text-sm text-navy-500">{subtitle}</span>
        )}
      </span>
      <span
        className={`ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-120 ease-out ${
          active ? 'border-navy-500 bg-navy-500' : 'border-navy-300'
        }`}
      >
        {active && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
    </button>
  );
}
