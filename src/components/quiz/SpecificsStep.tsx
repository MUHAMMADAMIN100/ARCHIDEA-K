import { FieldLabel, OptionCard, TextArea } from './fields';
import { DatePickerField } from './DatePickerField';
import { TimePickerField } from './TimePickerField';
import type { QuizState } from '../../types';

interface Props {
  state: QuizState;
  onChange: (next: QuizState) => void;
  /** Минимальная дата (сегодня) в формате YYYY-MM-DD */
  minDate: string;
}

export function SpecificsStep({ state, onChange, minDate }: Props) {
  const set = <K extends keyof QuizState>(key: K, value: QuizState[K]) =>
    onChange({ ...state, [key]: value });

  return (
    <div className="quiz-stack space-y-5 sm:space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <div>
          <FieldLabel required>Желаемая дата</FieldLabel>
          <DatePickerField
            value={state.date}
            minDate={minDate}
            onChange={(v) => set('date', v)}
          />
        </div>
        <div>
          <FieldLabel required>Удобное время</FieldLabel>
          <TimePickerField
            value={state.time}
            onChange={(v) => set('time', v)}
          />
        </div>
      </div>

      <div>
        <FieldLabel required>
          Есть ли доступ к воде и электричеству на объекте?
        </FieldLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            active={state.hasUtilities === 'yes'}
            onClick={() => set('hasUtilities', 'yes')}
            title="Да, всё подключено"
          />
          <OptionCard
            active={state.hasUtilities === 'no'}
            onClick={() => set('hasUtilities', 'no')}
            title="Нет / не уверен(а)"
          />
        </div>
      </div>

      <div>
        <FieldLabel required>Как клинер попадёт на объект?</FieldLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            active={state.access === 'keys'}
            onClick={() => set('access', 'keys')}
            title="Передам ключи"
            subtitle="Меня не будет на месте"
          />
          <OptionCard
            active={state.access === 'onsite'}
            onClick={() => set('access', 'onsite')}
            title="Буду на месте"
            subtitle="Встречу клинера лично"
          />
        </div>
      </div>

      <div>
        <FieldLabel>Комментарии и пожелания</FieldLabel>
        <TextArea
          rows={3}
          value={state.comment}
          onChange={(e) => set('comment', e.target.value)}
          placeholder="Например: особое внимание кухне, есть домашние животные, нужна уборка балкона…"
        />
      </div>
    </div>
  );
}
