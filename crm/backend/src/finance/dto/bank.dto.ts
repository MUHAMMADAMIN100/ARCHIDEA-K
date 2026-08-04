import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Новый банк в справочнике оплаты (ТЗ 3.1) */
export class CreateBankDto {
  @IsString()
  @MinLength(2, { message: 'Название банка слишком короткое' })
  @MaxLength(60)
  title: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class UpdateBankDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  title?: string;

  /** Скрытый банк не предлагается при оплате, но остаётся в старых платежах */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}
