import { IsIn, IsOptional } from "class-validator";
import { AnalyticsRange } from "../date.util";

export type { AnalyticsRange };

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = [
  "24h",
  "7d",
  "30d",
] as const;
export const ANALYTICS_GRANULARITIES = ["day", "hour"] as const;
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];

export class RangeQueryDto {
  @IsOptional()
  @IsIn([...ANALYTICS_RANGES])
  range?: AnalyticsRange;
}

export class TrendsQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsIn([...ANALYTICS_GRANULARITIES])
  granularity?: AnalyticsGranularity;
}
