import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ShiftGroupStatus } from '@prisma/client';

/** «09:30» — местное время Душанбе */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Разовый клинер на выезде (ТЗ 2): человек не заведён в базе клинеров */
export class GuestCleanerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  /** Выплата за смену, сомони */
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  rate: number;
}

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

  /** Разовые клинеры (замены): имя и выплата за смену — без записи в базе */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GuestCleanerDto)
  guests?: GuestCleanerDto[];
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

  /** Разовые клинеры: список задаётся целиком, как и состав */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GuestCleanerDto)
  guests?: GuestCleanerDto[];
}

export class CloseShiftGroupDto {
  @IsOptional()
  @IsString()
  @Matches(TIME, { message: 'Время окончания — в формате ЧЧ:ММ' })
  endTime?: string;

  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
