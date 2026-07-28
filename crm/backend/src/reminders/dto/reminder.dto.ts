import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReminderStatus } from '@prisma/client';

/** «2026-08-01» или «2026-08-01T14:30» — строка с фронта, парсится через common/time/dushanbe.parseDate */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateReminderDto {
  @IsString() clientId: string;

  @IsOptional() @IsString() orderId?: string;

  @IsString() @MaxLength(200) title: string;

  @IsOptional() @IsString() @MaxLength(2000) note?: string;

  /** Способ 1 — конкретные дата и время перезвона */
  @IsOptional()
  @Matches(DATE_RE, { message: 'Неверный формат даты напоминания' })
  remindAt?: string;

  /**
   * Способ 2 — интервал в днях от текущего момента:
   * «через неделю» = 7, «через месяц» = 30, «через 3 месяца» = 90 (считает фронт).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  intervalDays?: number;

  /** Исполнитель напоминания — задать может только руководство (ТЗ 10.1) */
  @IsOptional() @IsString() assigneeId?: string;
}

export class UpdateReminderDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;

  @IsOptional() @IsString() @MaxLength(2000) note?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'Неверный формат даты напоминания' })
  remindAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  intervalDays?: number;

  @IsOptional() @IsString() assigneeId?: string;
}

export class ReminderQueryDto {
  @IsOptional() @IsEnum(ReminderStatus) status?: ReminderStatus;

  @IsOptional() @Matches(DATE_ONLY_RE, { message: 'Формат даты: ГГГГ-ММ-ДД' }) from?: string;

  @IsOptional() @Matches(DATE_ONLY_RE, { message: 'Формат даты: ГГГГ-ММ-ДД' }) to?: string;

  /** Только для руководства — иначе список всегда скоупится на себя */
  @IsOptional() @IsString() assigneeId?: string;
}
