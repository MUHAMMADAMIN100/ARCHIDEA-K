import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  login: string;

  // на входе длину НЕ ограничиваем политикой: у части сотрудников могут
  // остаться старые короткие пароли — снаружи их запирать нельзя
  @IsString()
  @MinLength(1)
  password: string;

  /** «Запомнить меня»: сессия на 30 дней вместо 12 часов */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
