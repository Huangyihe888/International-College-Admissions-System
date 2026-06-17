import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * /chat/send (同步) 与 /chat/stream (SSE 流式) 共用 body。
 * 不带 question 走不通(ValidationPipe 直接 400)。
 * sessionId 可选:不传时 service 端按 visitorId 起新会话。
 */
export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sessionId?: string;
}
