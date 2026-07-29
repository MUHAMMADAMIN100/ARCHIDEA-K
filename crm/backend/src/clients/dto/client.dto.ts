import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ClientTag, LeadSource } from '@prisma/client';

export class CreateClientDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsString()
  @MinLength(5)
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
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
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
