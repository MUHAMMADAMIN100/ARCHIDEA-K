import { motion } from 'framer-motion';
import { IconCheck } from '../ui/icons';

interface Props {
  current: number;
  titles: string[];
}

export function Stepper({ current, titles }: Props) {
  const progress = ((current + 1) / titles.length) * 100;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="quiz-kicker">
            Шаг {current + 1} из {titles.length}
          </p>
          <p className="quiz-step-title mt-0.5">{titles[current]}</p>
        </div>
        <span className="quiz-pct shrink-0">{Math.round(progress)}%</span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-navy-100">
        <motion.div
          className="h-full rounded-full bg-brand-500"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <ol className="mt-4 grid grid-cols-3 gap-2 sm:flex sm:gap-2">
        {titles.map((title, i) => {
          const isDone = i < current;
          const isActive = i === current;
          return (
            <li
              key={title}
              className={`flex min-w-0 items-center justify-center sm:flex-1 sm:justify-start sm:gap-2 ${
                isActive
                  ? 'text-navy-900'
                  : isDone
                    ? 'text-brand-600'
                    : 'text-navy-400'
              }`}
            >
              <span
                className={`quiz-step-num flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-7 sm:w-7 sm:rounded-md ${
                  isActive || isDone
                    ? 'bg-brand-500 text-white'
                    : 'bg-navy-100 text-navy-500'
                }`}
              >
                {isDone ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="quiz-option-meta hidden min-w-0 truncate font-medium sm:inline">
                {title}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
