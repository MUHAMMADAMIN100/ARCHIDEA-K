import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CallType, ClientTag, LeadSource } from '@prisma/client';
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

  /** «От кого» пришёл клиент — рекомендатель или партнёр */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceDetail?: string;

  /**
   * Адрес клиента — подставляется в новые заказы.
   *
   * Необязателен на уровне API: у заведённых раньше клиентов его нет, и
   * обязательное поле сломало бы их сохранение. Спрашивает его форма
   * нового клиента, там оно обязательное.
   */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(ClientTag, { each: true })
  tags?: ClientTag[];

  /** Каким вышел разговор: холодный, нейтральный, горячий */
  @IsOptional()
  @IsEnum(CallType)
  callType?: CallType;

  /** Когда перезвонить — в календаре появится отметка «позвонить» */
  @IsOptional()
  @IsDateString()
  callbackAt?: string;

  /** Степень заинтересованности: «Перезвоню», «Подумаю» и свои варианты */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  interestLevel?: string;

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
  @IsOptional() @IsString() @MaxLength(120) sourceDetail?: string;
  /** Адрес клиента — подставляется в новые заказы */
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @IsArray() @IsEnum(ClientTag, { each: true }) tags?: ClientTag[];
  /*
   * Холодные звонки. Пустая строка и null означают «снять значение» —
   * менеджер должен иметь возможность стереть ошибочно выбранный тип
   * разговора или отменить перезвон, а не только заменить его другим.
   */
  @IsOptional() @IsEnum(CallType) callType?: CallType | null;
  @IsOptional() @IsDateString() callbackAt?: string | null;
  @IsOptional() @IsString() @MaxLength(40) interestLevel?: string | null;
  @IsOptional() @IsString() managerId?: string;
}
