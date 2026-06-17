import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * 反馈 DTO — 语义上 rating 是 POSITIVE / NEGATIVE,
 * 但 Prisma enum FeedbackRating 是 UP / DOWN,映射在 service.feedback() 完成。
 * (DTO 保持面向用户的语义,不暴露 Prisma 内部命名。)
 */
export class FeedbackDto {
  @IsEnum(["POSITIVE", "NEGATIVE"])
  rating!: "POSITIVE" | "NEGATIVE";

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
