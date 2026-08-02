import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsPersonName, IsTjPhone } from '../../common/validation/contact';

/** Данные калькулятора (площадь, тип уборки, доп. услуги) */
class CalculatorDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  area?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cleaningTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  dirtLevel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  seats?: number;

  // словарь доп. услуг {ключ: количество}; сам объект не разворачиваем,
  // но ограничиваем, чтобы не принять гигантскую структуру
  @IsOptional()
  @IsObject()
  extras?: Record<string, number>;
}

/** Данные квиза (дата, время, доступ, комментарий) */
class QuizDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  hasUtilities?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  access?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/** Контакты клиента */
class ContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @IsPersonName()
  name?: string;

  @IsOptional()
  @IsString()
  @IsTjPhone()
  phone?: string;

  /** Запасной номер с сайта — попадает в запасные телефоны карточки клиента */
  @IsOptional()
  @IsString()
  @IsTjPhone()
  phone2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

/**
 * Заявка с лендинга. Раньше все поля были помечены @Allow() — это отключало
 * валидацию, и в БД проходили строки/числа любой длины и мусор (риск порчи
 * данных и отказа CRM). Теперь — строгие лимиты и типы.
 */
export class LeadIntakeDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CalculatorDto)
  calculator?: CalculatorDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => QuizDto)
  quiz?: QuizDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ContactDto)
  contact?: ContactDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  total?: number;

  /** honeypot — должно быть пустым (антиспам) */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;
}
