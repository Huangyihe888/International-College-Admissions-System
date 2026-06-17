import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { PaginationDto } from "../../../common/dto/pagination.dto";
import { AnalyticsRange, ANALYTICS_RANGES } from "./overview-query.dto";

/**
 * Query string 中的布尔值转换:只接受字面量 "true"/"false"(大小写不敏感),
 * 其他值(包括空字符串)返回 undefined 走兜底,避免 class-transformer 把 "false" 视作 truthy。
 */
const toBool = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
};

/**
 * 问答日志查询 / 导出 CSV 通用 DTO。
 * 继承 PaginationDto 拿到 page / pageSize,自身补 isAnswered / faqHit / startDate / endDate / keyword。
 */
export class AnalyticsQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn([...ANALYTICS_RANGES])
  range?: AnalyticsRange;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isAnswered?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  faqHit?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}

/**
 * Top 热门问题参数(1~100,默认 20)。
 * 不继承 PaginationDto,语义不同。
 *  - range: 24h / 7d / 30d;与 overview/trends 保持一致语义
 *  - isAnswered / faqHit: 可选筛选,只统计 AI 真正给答案的、或直接命中 FAQ 的问题
 */
export class TopQuestionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsIn([...ANALYTICS_RANGES])
  range?: AnalyticsRange;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isAnswered?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  faqHit?: boolean;
}
