import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
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

export class CreateFaqDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  question!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  answer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateFaqDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  question?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  answer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class FaqListQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}
