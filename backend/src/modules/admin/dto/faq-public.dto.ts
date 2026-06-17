import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/**
 * 公共 FAQ 检索(GET /faqs)参数。
 *  - keyword: 模糊匹配 question / answer
 *  - limit: 1~100,默认 20
 */
export class PublicFaqSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value,
  )
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
