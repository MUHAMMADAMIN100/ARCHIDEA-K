import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AccessMethod,
  CleaningType,
  DirtLevel,
  FunnelStage,
  LeadSource,
} from '@prisma/client';

// Верхняя граница для целых полей — ниже int32 (Prisma Int), чтобы
// огромное число давало 400 (валидация), а не 500 (переполнение БД).
const MAX_INT = 2_000_000_000;

export class CreateOrderDto {
  @IsString() clientId: string;
  @IsOptional() @IsEnum(CleaningType) cleaningType?: CleaningType;
  @IsOptional() @IsEnum(DirtLevel) dirtLevel?: DirtLevel;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) area?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) seats?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) estimatedPrice?: number;
  @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() managerId?: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsEnum(CleaningType) cleaningType?: CleaningType;
  @IsOptional() @IsEnum(DirtLevel) dirtLevel?: DirtLevel;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) area?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) seats?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) estimatedPrice?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) pricePerSqm?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) finalPrice?: number;
  @IsOptional() @IsString() @MaxLength(2000) preferences?: string;
  @IsOptional() @IsString() inspectionDate?: string;
  @IsOptional() @IsString() scheduledDate?: string;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsEnum(AccessMethod) accessMethod?: AccessMethod;
  @IsOptional() @IsBoolean() hasUtilities?: boolean;
  @IsOptional() @IsString() managerId?: string;
}

export class ChangeStageDto {
  @IsEnum(FunnelStage) stage: FunnelStage;
  @IsOptional() @IsString() rejectionReason?: string;
  @IsOptional() @IsString() scheduledDate?: string;
}

export class AssignCleanersDto {
  @IsArray() @IsString({ each: true }) cleanerIds: string[];
}
