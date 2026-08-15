import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
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

/** Строка дополнительной основной услуги заявки (мульти-выбор, ТЗ 1.3) */
export class AdditionalServiceDto {
  @IsString()
  @MaxLength(40)
  key: string;

  /** Объём: м² или количество — в единицах услуги */
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  qty: number;

  /** Цена за единицу, если менеджер поправил её руками */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  pricePerUnit?: number;
}

/** Разовый сотрудник под заказ: кого позвали и сколько отдали */
export class OrderGuestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  /** Сколько ему отдали, сомони */
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  rate: number;
}

/**
 * Своя доп. услуга заказа: название, цена и отметка «включить в счёт».
 *
 * Заводится прямо в карточке заказа: справочник для этого не нужен, а
 * «вынос мусора — 150» вписывать было некуда.
 */
export class CustomExtraDto {
  @IsString() @MaxLength(120) title: string;

  @IsInt() @Min(0) @Max(MAX_INT) price: number;

  /** Не отмечена — остаётся в карточке заметкой, в сумму не идёт */
  @IsOptional() @IsBoolean() checked?: boolean;
}

export class CreateOrderDto {
  @IsString() clientId: string;
  @IsOptional() @IsEnum(CleaningType) cleaningType?: CleaningType;
  /** Ключ услуги (ТЗ 1.1) — приоритетнее cleaningType, если задан */
  @IsOptional() @IsString() @MaxLength(40) serviceKey?: string;
  @IsOptional() @IsEnum(DirtLevel) dirtLevel?: DirtLevel;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) area?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) seats?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) estimatedPrice?: number;
  /** Цена за единицу (ТЗ 5); не задана — подставляется из услуги */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) pricePerSqm?: number;
  /** Итог, если менеджер задал его вручную (ТЗ 5) */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) finalPrice?: number;
  /** Выбранные доп. услуги с сайта: ключ услуги → количество */
  @IsOptional()
  @IsObject()
  extras?: Record<string, number>;

  /** Свои доп. услуги строками — в сумму идут только отмеченные */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomExtraDto)
  customExtras?: CustomExtraDto[];

  /** Скидка в сомони — вычитается из суммы работ и доп. услуг */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  discount?: number;

  /** Разовые сотрудники под этот заказ */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderGuestDto)
  guestCleaners?: OrderGuestDto[];

  /** Дополнительные основные услуги заявки (ТЗ 1.3) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AdditionalServiceDto)
  additionalServices?: AdditionalServiceDto[];

  /** «От кого» пришла заявка (ТЗ 1.4) */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceDetail?: string;

  @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @IsString() @MaxLength(2000) preferences?: string;
  @IsOptional() @IsString() managerId?: string;
  /**
   * Бригада на заказ прямо при оформлении (ТЗ 3.1).
   * Раньше команду можно было назначить только повторным открытием заказа.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  cleanerIds?: string[];
}

export class UpdateOrderDto {
  @IsOptional() @IsEnum(CleaningType) cleaningType?: CleaningType;
  @IsOptional() @IsString() @MaxLength(40) serviceKey?: string;
  @IsOptional() @IsEnum(DirtLevel) dirtLevel?: DirtLevel;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) area?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) seats?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) estimatedPrice?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) pricePerSqm?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) finalPrice?: number;
  /**
   * Итог задан вручную (ТЗ 5): автоматический пересчёт его больше не трогает,
   * пока менеджер сам не вернёт автоматический режим.
   */
  @IsOptional() @IsBoolean() isManualPrice?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) preferences?: string;
  @IsOptional() @IsString() inspectionDate?: string;
  @IsOptional() @IsString() scheduledDate?: string;
  /** Последний день, если уборка идёт не один день */
  @IsOptional() @IsString() scheduledEndDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @IsEnum(AccessMethod) accessMethod?: AccessMethod;
  @IsOptional() @IsBoolean() hasUtilities?: boolean;
  @IsOptional() @IsString() managerId?: string;
  /*
   * Поля, которые раньше были только для чтения в карточке заказа.
   * Менеджер должен иметь возможность поправить их вручную: заявка могла
   * прийти с опечаткой, не тем источником или не тем временем.
   */
  @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  /** Выбранные доп. услуги: ключ услуги → количество */
  @IsOptional() @IsObject() extras?: Record<string, number>;
  /** Свои доп. услуги строками — в сумму идут только отмеченные */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomExtraDto)
  customExtras?: CustomExtraDto[];
  /** Скидка в сомони — вычитается из суммы работ и доп. услуг */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_INT) discount?: number;
  /** Разовые сотрудники под этот заказ */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderGuestDto)
  guestCleaners?: OrderGuestDto[];
  /** Дополнительные основные услуги заявки (ТЗ 1.3) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AdditionalServiceDto)
  additionalServices?: AdditionalServiceDto[];
  /** «От кого» пришла заявка (ТЗ 1.4) */
  @IsOptional() @IsString() @MaxLength(120) sourceDetail?: string;
  @IsOptional() @IsString() createdAt?: string;
  @IsOptional() @IsString() preferredDate?: string;
  @IsOptional() @IsString() @MaxLength(20) preferredTime?: string;
}

export class ChangeStageDto {
  @IsEnum(FunnelStage) stage: FunnelStage;
  @IsOptional() @IsString() @MaxLength(1000) rejectionReason?: string;
  @IsOptional() @IsString() scheduledDate?: string;
  @IsOptional() @IsString() scheduledEndDate?: string;
}

export class AssignCleanersDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  cleanerIds: string[];
}

export class DeleteOrderDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
