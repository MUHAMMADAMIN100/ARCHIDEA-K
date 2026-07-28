import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  login: string;

  // политика паролей: минимум 8 символов
  @IsString()
  @MinLength(8, { message: 'Пароль должен быть не короче 8 символов' })
  password: string;

  @IsString()
  fullName: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  phone?: string;
}

/**
 * Правка карточки сотрудника.
 * Раньше тело запроса описывалось inline-типом: глобальный ValidationPipe
 * с whitelist не имеет класса для проверки и пропускает что угодно.
 */
export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(60) login?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) position?: string;
  @IsOptional() @IsString() @MaxLength(4000) duties?: string;
  @IsOptional() @IsString() @MaxLength(1000) mainTask?: string;
  @IsOptional() @IsEnum(Role) role?: Role;

  /** Расширенный доступ: как у директора, но без финансов */
  @IsOptional() @IsBoolean() canManageOps?: boolean;
  /** ТЗ 1.2 — полный доступ к модулю задач */
  @IsOptional() @IsBoolean() canManageTasks?: boolean;
  @IsOptional() @IsBoolean() acceptsLeads?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Пароль должен быть не короче 8 символов' })
  password?: string;

  /** ТЗ 10 — личные уведомления: сотрудник пишет боту, id вносится сюда */
  @IsOptional() @IsString() @MaxLength(40) telegramChatId?: string | null;
  @IsOptional() @IsBoolean() telegramEnabled?: boolean;
}
