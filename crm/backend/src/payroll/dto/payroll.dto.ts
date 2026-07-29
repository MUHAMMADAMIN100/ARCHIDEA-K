import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Отметка смен за день.
 *
 * baseline — список тех, кого клиент ВИДЕЛ при загрузке. Удаляются только
 * снятые отметки из него: иначе запрос с пустым списком без baseline стёр бы
 * все смены дня и испортил выплаты.
 */
export class MarkDayDto {
  @IsISO8601()
  date: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  cleanerIds: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  baseline?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CreateFineDto {
  @IsString()
  @MaxLength(40)
  cleanerId: string;

  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  amount: number;

  @IsString()
  @MinLength(3, { message: 'Укажите причину штрафа' })
  @MaxLength(500)
  reason: string;

  /** «ГГГГ-ММ-ДД»; не указана — сегодняшний день по Душанбе */
  @IsOptional()
  @IsISO8601()
  date?: string;
}
