import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuditAction } from '@prisma/client';
import { AUDIT_ENTITIES } from '../audit.types';

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @IsEnum(AUDIT_ENTITIES as unknown as object, {
    message: 'Неизвестный тип объекта',
  })
  entity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  entityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  actorId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  /** «ГГГГ-ММ-ДД» */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
