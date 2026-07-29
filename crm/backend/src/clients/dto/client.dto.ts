import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
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
  @IsOptional() @IsArray() @IsEnum(ClientTag, { each: true }) tags?: ClientTag[];
  @IsOptional() @IsString() managerId?: string;
}
