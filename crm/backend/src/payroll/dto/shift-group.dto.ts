import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ShiftGroupStatus } from '@prisma/client';

/** «09:30» — местное время Душанбе */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateShiftGroupDto {
  /** День выезда, «ГГГГ-ММ-ДД» */
  @IsISO8601()
  date: string;

  /** Точный адрес объекта — обязателен по ТЗ 4 */
  @IsString()
  @MinLength(3, { message: 'Укажите адрес объекта' })
  @MaxLength(300)
  address: string;

  @IsOptional() @IsString() @MaxLength(40) orderId?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME, { message: 'Время начала — в формате ЧЧ:ММ' })
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME, { message: 'Время окончания — в формате ЧЧ:ММ' })
  endTime?: string;

  @IsOptional() @IsString() @MaxLength(40) brigadeId?: string;
  @IsOptional() @IsString() @MaxLength(40) brigadierId?: string;
  @IsOptional() @IsString() @MaxLength(40) managerId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;

  /** Кто поехал — поимённый состав (ТЗ 4) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  cleanerIds?: string[];
}

export class UpdateShiftGroupDto {
  @IsOptional() @IsISO8601() date?: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Укажите адрес объекта' })
  @MaxLength(300)
  address?: string;

  @IsOptional() @IsString() @MaxLength(40) orderId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(TIME, { message: 'Время начала — в формате ЧЧ:ММ' })
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME, { message: 'Время окончания — в формате ЧЧ:ММ' })
  endTime?: string;

  @IsOptional() @IsString() @MaxLength(40) brigadeId?: string | null;
  @IsOptional() @IsString() @MaxLength(40) brigadierId?: string | null;
  @IsOptional() @IsString() @MaxLength(40) managerId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsEnum(ShiftGroupStatus) status?: ShiftGroupStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  cleanerIds?: string[];
}

export class CloseShiftGroupDto {
  @IsOptional()
  @IsString()
  @Matches(TIME, { message: 'Время окончания — в формате ЧЧ:ММ' })
  endTime?: string;

  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
