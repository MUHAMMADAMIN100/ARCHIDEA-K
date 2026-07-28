import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { TRASH_TYPES, TrashType } from '../trash.registry';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /trash?type&search&from&to&take&skip */
export class TrashListQueryDto {
  @IsOptional()
  @IsIn(TRASH_TYPES)
  type?: TrashType;

  @IsOptional()
  @IsString()
  search?: string;

  /** «ГГГГ-ММ-ДД» — дата удаления, начало диапазона */
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'Дата должна быть в формате ГГГГ-ММ-ДД' })
  from?: string;

  /** «ГГГГ-ММ-ДД» — дата удаления, конец диапазона */
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'Дата должна быть в формате ГГГГ-ММ-ДД' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

/** DELETE /trash?type&olderThanDays&confirm=true */
export class TrashPurgeQueryDto {
  @IsOptional()
  @IsIn(TRASH_TYPES)
  type?: TrashType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  olderThanDays?: number;

  /**
   * Строка, а не boolean: class-transformer превращает ЛЮБУЮ непустую строку
   * (в т.ч. «false») в true через Boolean(value) — сверяем значение сами.
   */
  @IsOptional()
  @IsString()
  confirm?: string;
}
