import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * POST /chat/sessions 显式建会话的入参。
 * title 缺省时由 service 在收到首条 USER 消息后再回填(question 前 50 字)。
 */
export class CreateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
