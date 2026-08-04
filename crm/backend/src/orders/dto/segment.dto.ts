import { Transform, Type } from 'class-transformer';
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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SegmentKind } from '@prisma/client';

/** Помещение — нижний уровень разбивки */
export class RoomDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  /** Площадь помещения, м² */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) area?: number;

  /** Что делать именно здесь, если отличается от общего состава работ */
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Этаж: набор помещений */
export class FloorDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) area?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RoomDto)
  rooms?: RoomDto[];
}

/** Блок объекта: корпус, подъезд, здание */
export class BlockDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) area?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FloorDto)
  floors?: FloorDto[];
}

/**
 * Разбивка объекта целиком (ТЗ: объём работ).
 *
 * Дерево приходит и сохраняется одним запросом, а не по узлу за раз: менеджер
 * правит структуру объекта как единое целое — добавил этаж, перенёс комнату,
 * поправил площади, — и промежуточные состояния никому не нужны.
 */
export class ReplaceSegmentsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BlockDto)
  blocks: BlockDto[];

  /**
   * Подставить итоговую площадь в заказ.
   *
   * По умолчанию нет: площадь заказа — это то, за что выставлен счёт, и
   * менять её молча при правке структуры нельзя.
   */
  @IsOptional() @IsBoolean() applyArea?: boolean;
}

/** Уровень — на случай, если понадобится точечная правка узла */
export const SEGMENT_KINDS = Object.values(SegmentKind);

export class UpdateSegmentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) area?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsEnum(SegmentKind) kind?: SegmentKind;
}
