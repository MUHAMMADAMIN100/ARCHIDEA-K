import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

/** Верхняя граница суммы — та же, что у цен: защита от опечатки в десять нулей */
const MAX_AMOUNT = 2_000_000_000;

/**
 * Одна часть оплаты: чем и сколько.
 *
 * Используется и как самостоятельный взнос («клиент занёс предоплату
 * наличными»), и как строка смешанной оплаты («1000 наличными + 1500 Алиф»).
 */
export class PaymentPartDto {
  @IsInt()
  @Min(1, { message: 'Сумма взноса должна быть больше нуля' })
  @Max(MAX_AMOUNT)
  amount: number;

  @IsEnum(PaymentMethod, { message: 'Выберите способ оплаты: наличные или банк' })
  method: PaymentMethod;

  /**
   * Банк обязателен при безналичном расчёте — это и есть требование ТЗ 3.1.
   * Проверку связки «BANK ⇒ bankId» делает сервис: тут её не выразить.
   */
  @IsOptional()
  @IsString()
  bankId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Внесение оплаты: одна часть или сразу несколько (смешанная оплата) */
export class CreatePaymentDto {
  /**
   * Части оплаты. Одна строка — обычный взнос, несколько — смешанная оплата.
   * Больше двадцати каналов на один платёж не бывает, а ограничение защищает
   * от случайной отправки огромного массива.
   */
  @IsArray()
  @ArrayMinSize(1, { message: 'Укажите хотя бы одну часть оплаты' })
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PaymentPartDto)
  parts: PaymentPartDto[];

  /** Дата получения денег — по ней взнос попадает в доходы. По умолчанию сегодня */
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  /**
   * Сколько всего вносится этим платежом.
   *
   * Нужно ровно для требования ТЗ 3.2: сумма частей должна СТРОГО совпадать
   * с заявленной суммой, иначе оплата не проводится. Если поле не передали,
   * сумма берётся из частей и проверять нечего.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  expectedTotal?: number;
}

/** Правка уже внесённого взноса */
export class UpdatePaymentDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  bankId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
