import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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

export class AnswerLowConfidenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  answer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;
}

export class LowConfidenceListQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isAnswered?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  // 客户端可显式传阈值,否则 service 走默认 0.5
  threshold?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}
