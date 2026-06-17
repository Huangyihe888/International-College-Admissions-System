import { IsString, IsNotEmpty, MaxLength } from "class-validator";

/**
 * multipart/form-data 字段:kbVersionId 走 @Body() 校验,
 * file 走 @UploadedFile() 由 FileInterceptor 解析。
 */
export class UploadDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  kbVersionId!: string;
}
