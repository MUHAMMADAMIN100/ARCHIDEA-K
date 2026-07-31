import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ClientTag, LeadSource } from '@prisma/client';
import { IsPersonName, IsTjPhone } from '../../common/validation/contact';

export class CreateClientDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsPersonName()
  fullName: string;

  @IsString()
  @IsTjPhone()
  phone: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  notes?: string;

  /** ТЗ 10.2 — постоянные предпочтения клиента */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preferences?: string;

  /** Постоянная скидка клиента в сомони — подставляется в новые заказы */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  discount?: number;

  /** Запасные номера «на всякий случай» — та же проверка, что и у основного */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsTjPhone({ each: true })
  extraPhones?: string[];

  /** Свободные теги для сегментации — в дополнение к единственному статусу */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];

  /** «От кого» пришёл клиент — рекомендатель или партнёр */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceDetail?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(ClientTag, { each: true })
  tags?: ClientTag[];

  @IsOptional()
  @IsString()
  managerId?: string;
}

export class UpdateClientDto {
  @IsOptional() @IsString() @MaxLength(120) @IsPersonName() fullName?: string;
  @IsOptional() @IsString() @IsTjPhone() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  @IsOptional() @IsString() notes?: string;
  /**
   * ТЗ 10.2 — предпочтения клиента. Без этого поля глобальный ValidationPipe
   * с whitelist молча выбрасывал его из запроса, и сохранение «работало»,
   * ничего не сохраняя.
   */
  @IsOptional() @IsString() @MaxLength(2000) preferences?: string;
  /** Постоянная скидка клиента в сомони */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) discount?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsTjPhone({ each: true })
  extraPhones?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];
  @IsOptional() @IsString() @MaxLength(120) sourceDetail?: string;
  @IsOptional() @IsArray() @IsEnum(ClientTag, { each: true }) tags?: ClientTag[];
  @IsOptional() @IsString() managerId?: string;
}
