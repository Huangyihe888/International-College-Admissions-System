import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { DocumentStatus } from "@prisma/client";
import { PaginationDto } from "../../../common/dto/pagination.dto";

export class DocumentListQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  kbVersionId?: string;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}
