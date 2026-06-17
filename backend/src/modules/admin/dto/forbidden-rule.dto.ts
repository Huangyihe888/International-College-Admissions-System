import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { ForbiddenRuleType } from "@prisma/client";
import { PaginationDto } from "../../../common/dto/pagination.dto";

const toBool = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
};

export class CreateForbiddenRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  pattern!: string;

  @IsEnum(ForbiddenRuleType)
  ruleType!: ForbiddenRuleType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reply?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateForbiddenRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  pattern?: string;

  @IsOptional()
  @IsEnum(ForbiddenRuleType)
  ruleType?: ForbiddenRuleType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reply?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class ForbiddenRuleListQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(ForbiddenRuleType)
  ruleType?: ForbiddenRuleType;
}
