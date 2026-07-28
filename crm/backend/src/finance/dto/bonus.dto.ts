import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_AMOUNT = 2_000_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Дата в формате ГГГГ-ММ-ДД';

export class CreateBonusDto {
  /** Получатель — ровно один из двух: клинер или сотрудник CRM (проверяется в сервисе) */
  @IsOptional() @IsString() cleanerId?: string;
  @IsOptional() @IsString() userId?: string;

  @IsInt() @Min(1) @Max(MAX_AMOUNT) amount: number;
  @IsString() @MinLength(3) @MaxLength(500) reason: string;

  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) periodFrom?: string;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) periodTo?: string;
}

export class UpdateBonusDto {
  @IsOptional() @IsInt() @Min(1) @Max(MAX_AMOUNT) amount?: number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?: string;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) periodFrom?: string;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) periodTo?: string;
}

export class ListBonusDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() cleanerId?: string;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) from?: string;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) to?: string;
}
