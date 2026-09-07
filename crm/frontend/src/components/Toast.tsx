import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

/**
 * Настройки всплывашки.
 *
 * sticky — не исчезает сама: так показывается «не сохранилось», которое
 * человек обязан увидеть, даже если ушёл с экрана и вернулся через минуту.
 * action — кнопка в самой плашке («Повторить»): нажали — плашка гаснет,
 * действие выполняется.
 */
export interface ToastOptions {
  sticky?: boolean;
  action?: { label: string; onClick: () => void };
}

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  sticky?: boolean;
  action?: ToastOptions['action'];
}

interface ToastApi {
  push: (message: string, type?: ToastType, opts?: ToastOptions) => void;
  success: (message: string) => void;
  error: (message: string, opts?: ToastOptions) => void;
  /** нейтральное уведомление — не успех и не ошибка («клиент уже есть») */
  info: (message: string) => void;
}

const Ctx = createContext<ToastApi>({
  push: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
});

export const useToast = () => useContext(Ctx);

const STYLE: Record<ToastType, string> = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-navy-200 bg-white text-navy-700',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback(
    (id: number) => setItems((x) => x.filter((t) => t.id !== id)),
    [],
  );

  const push = useCallback(
    (message: string, type: ToastType = 'info', opts?: ToastOptions) => {
      const id = (idRef.current += 1);
      setItems((x) => [
        ...x,
        { id, type, message, sticky: opts?.sticky, action: opts?.action },
      ]);
      // «не сохранилось» висит, пока человек сам не закроет или не повторит
      if (!opts?.sticky) setTimeout(() => remove(id), 3500);
    },
    [remove],
  );

  const api: ToastApi = {
    push,
    success: (m) => push(m, 'success'),
    error: (m, opts) => push(m, 'error', opts),
    info: (m) => push(m, 'info'),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* правый верхний угол, рядом с колокольчиком, — решение владельца */}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => {
          const Icon =
            t.type === 'error' ? AlertCircle : t.type === 'success' ? CheckCircle2 : Info;
          return (
            <div
              key={t.id}
              /*
                Уведомление всплывает над страницей, поэтому уровень высоты
                тот же, что у выпадашек, — pop, а не card.
              */
              className={`pointer-events-auto flex animate-fade-in items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-pop ${STYLE[t.type]}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">
                {t.message}
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      remove(t.id);
                      t.action?.onClick();
                    }}
                    className="press mt-1.5 block rounded-lg border border-current px-2.5 py-1 text-xs font-semibold"
                  >
                    {t.action.label}
                  </button>
                )}
              </span>
              <button
                onClick={() => remove(t.id)}
                className="press opacity-60 transition-[opacity,transform] duration-120 ease-out hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
