import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Верхняя граница цены — защита от опечатки в лишний ноль и переполнения Int */
const MAX_PRICE = 2_000_000_000;

export class CreateTariffDto {
  /**
   * Ключ услуги. Не вводится руками: генерируется из названия (см.
   * service-key.ts), потому что человеку он не нужен, а обязательное поле
   * блокировало сохранение. Принимаем только если задан явно.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message:
      'Ключ услуги — латинские заглавные буквы, цифры и подчёркивание (например DEEP_CLEANING)',
  })
  key?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Единица измерения: «м²», «место», «шт» */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  /** Цены различаются по степени загрязнения */
  @IsOptional()
  @IsBoolean()
  hasLevels?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  priceLight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  priceMedium?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  priceHeavy?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Что входит в услугу и что не входит — построчно (ТЗ: объём работ).
   *
   * Список нужен не для красоты: спор «а окна вы должны были мыть?» решается
   * только тем, что записано заранее. Он же печатается в КП.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  includedWorks?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  excludedWorks?: string[];

  /** Выработка: сколько единиц успевает один человек за смену (ТЗ: планирование) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  outputPerDay?: number;

  /**
   * Минимальная цена заказа и порог объёма (решение владельца): объект
   * МЕНЬШЕ порога стоит ровно minPrice. Ноль в любом из полей — правила нет.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  minPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  minArea?: number;
}

export class UpdateTariffDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** У базовых услуг единица не меняется — на неё завязан лендинг */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  hasLevels?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  priceLight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  priceMedium?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  priceHeavy?: number;

  /** Формат старого фронтенда: одна цена на все уровни */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  pricePerSqm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Что входит в услугу и что не входит — построчно (ТЗ: объём работ).
   *
   * Список нужен не для красоты: спор «а окна вы должны были мыть?» решается
   * только тем, что записано заранее. Он же печатается в КП.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  includedWorks?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  excludedWorks?: string[];

  /** Выработка: сколько единиц успевает один человек за смену (ТЗ: планирование) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  outputPerDay?: number;

  /**
   * Минимальная цена заказа и порог объёма (решение владельца): объект
   * МЕНЬШЕ порога стоит ровно minPrice. Ноль в любом из полей — правила нет.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  minPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  minArea?: number;
}

export class CreateExtraDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'Ключ доп. услуги — латинские строчные буквы, цифры и подчёркивание (например dry_cleaning)',
  })
  key?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  price: number;

  /** Цена умножается на количество (например мытьё окон) */
  @IsOptional()
  @IsBoolean()
  hasQty?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateExtraDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  price?: number;

  @IsOptional()
  @IsBoolean()
  hasQty?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class DeleteServiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
