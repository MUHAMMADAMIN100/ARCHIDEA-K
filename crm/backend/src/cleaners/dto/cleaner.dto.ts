import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsPersonName, IsTjPhone } from '../../common/validation/contact';

export class CreateCleanerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsPersonName()
  fullName: string;

  @IsOptional()
  @IsString()
  @IsTjPhone()
  phone?: string;

  /** Ставка за смену — деньги, поэтому менять её может только руководитель */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  brigadeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  managerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  duties?: string;
}

export class UpdateCleanerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsPersonName()
  fullName?: string;

  @IsOptional()
  @IsString()
  @IsTjPhone()
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  brigadeId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  duties?: string;
}

export class CreateBrigadeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;
}

export class UpdateBrigadeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  leaderId?: string | null;
}
