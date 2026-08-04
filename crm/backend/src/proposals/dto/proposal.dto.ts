import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProposalStatus } from '@prisma/client';

// Верхняя граница для целых полей — ниже int32 (Prisma Int), как в orders/order.dto.ts
const MAX_INT = 2_000_000_000;

// ─────────────────────── Шаблоны КП (ТЗ 9.1) ───────────────────────

export class CreateProposalTemplateDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(2000) intro?: string;
  @IsString() @MinLength(1) @MaxLength(10000) body: string;
  @IsOptional() @IsString() @MaxLength(2000) conditions?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) validDays?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateProposalTemplateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) intro?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(10000) body?: string;
  @IsOptional() @IsString() @MaxLength(2000) conditions?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) validDays?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ─────────────────────── КП (ТЗ 9.1/9.2) ───────────────────────

/** Одна позиция сметы: {title, volume?, unitPrice?, amount?} */
export class ProposalItemDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsNumber() @Min(0) @Max(MAX_INT) volume?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) unitPrice?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) amount?: number;
  /** Раздел сметы: «Работы», «Дополнительные услуги» и т.п. (ТЗ 9) */
  @IsOptional() @IsString() @MaxLength(80) section?: string;
  /** Единица объёма: м², место, шт */
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
}

/** Ручные корректировки поверх данных заказа/клиента при создании КП */
export class ProposalOverridesDto {
  @IsOptional()
  @IsArray()
  // смета на две сотни строк уже нечитаема, а без предела в неё можно
  // отправить всё, что влезет в тело запроса
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ProposalItemDto)
  items?: ProposalItemDto[];

  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) discount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) total?: number;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) area?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) pricePerSqm?: number;
}

export class CreateProposalDto {
  @IsString() clientId: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() templateId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProposalOverridesDto)
  overrides?: ProposalOverridesDto;
}

/** Правка КП — только пока в статусе DRAFT (кроме директора, см. проверку в сервисе) */
export class UpdateProposalDto {
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) area?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) pricePerSqm?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) discount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) total?: number;

  @IsOptional()
  @IsArray()
  // смета на две сотни строк уже нечитаема, а без предела в неё можно
  // отправить всё, что влезет в тело запроса
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ProposalItemDto)
  items?: ProposalItemDto[];

  @IsOptional() @IsDateString() validUntil?: string;
  /** Ручная правка итогового текста — если задана, автоперерендер не выполняется */
  @IsOptional() @IsString() @MaxLength(20000) bodySnapshot?: string;
}

export class SendProposalDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ChangeProposalStatusDto {
  @IsIn([ProposalStatus.ACCEPTED, ProposalStatus.REJECTED])
  status: Extract<ProposalStatus, 'ACCEPTED' | 'REJECTED'>;
}
