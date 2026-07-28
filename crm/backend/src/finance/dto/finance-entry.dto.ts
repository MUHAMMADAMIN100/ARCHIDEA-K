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
import { FinanceCategory, FinanceKind, FinanceSource } from '@prisma/client';

// Ниже int32 (Prisma Int) — чтобы огромное число давало 400, а не 500 при записи
const MAX_AMOUNT = 2_000_000_000;
/** «ГГГГ-ММ-ДД» — единственный формат дат, который принимают формы */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Дата в формате ГГГГ-ММ-ДД';

export class CreateFinanceEntryDto {
  @IsEnum(FinanceKind) kind: FinanceKind;
  @IsEnum(FinanceCategory) category: FinanceCategory;
  @IsInt() @Min(1) @Max(MAX_AMOUNT) amount: number;
  @Matches(DATE_RE, { message: DATE_MESSAGE }) date: string;
  @IsString() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() shiftGroupId?: string;
}

export class UpdateFinanceEntryDto {
  @IsOptional() @IsEnum(FinanceKind) kind?: FinanceKind;
  @IsOptional() @IsEnum(FinanceCategory) category?: FinanceCategory;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_AMOUNT) amount?: number;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) date?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() shiftGroupId?: string;
}

export class ListFinanceEntryDto {
  @IsOptional() @IsEnum(FinanceKind) kind?: FinanceKind;
  @IsOptional() @IsEnum(FinanceCategory) category?: FinanceCategory;
  @IsOptional() @IsEnum(FinanceSource) source?: FinanceSource;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) from?: string;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) to?: string;
  @IsOptional() @IsString() orderId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) take?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
}

export class FinanceSummaryDto {
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) from?: string;
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) to?: string;
}
