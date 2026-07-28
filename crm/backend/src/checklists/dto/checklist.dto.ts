import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CleaningType } from '@prisma/client';

/** Верхняя граница порядка сортировки — просто разумный предел, не бизнес-правило */
const MAX_SORT_ORDER = 10_000;
/** Пунктов в шаблоне/чек-листе больше сотни быть не должно — это чек-лист уборки, а не регламент */
const MAX_ITEMS = 100;

export class ChecklistTemplateItemDto {
  @IsString()
  @MaxLength(300)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  section?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SORT_ORDER)
  sortOrder?: number;
}

export class CreateChecklistTemplateDto {
  @IsString()
  @MaxLength(200)
  name: string;

  /** null — шаблон подходит любому виду уборки */
  @IsOptional()
  @IsEnum(CleaningType)
  cleaningType?: CleaningType | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  serviceKey?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ChecklistTemplateItemDto)
  items: ChecklistTemplateItemDto[];
}

/** Правка — items передаются полной заменой, как в create */
export class UpdateChecklistTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEnum(CleaningType)
  cleaningType?: CleaningType | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  serviceKey?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ChecklistTemplateItemDto)
  items?: ChecklistTemplateItemDto[];
}

export class ApplyChecklistTemplateDto {
  @IsOptional()
  @IsString()
  templateId?: string;
}

export class ToggleChecklistItemDto {
  @IsBoolean()
  isDone: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}

export class AddChecklistItemDto {
  @IsString()
  @MaxLength(300)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  section?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SORT_ORDER)
  sortOrder?: number;
}
