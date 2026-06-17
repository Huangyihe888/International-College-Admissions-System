import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
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

export class CreateKbVersionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  // 限制字母数字 + 点 + 横线 + 下划线,避免奇怪字符
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: "version must be alphanumeric with . _ -",
  })
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class KbVersionListQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  keyword?: string;
}
