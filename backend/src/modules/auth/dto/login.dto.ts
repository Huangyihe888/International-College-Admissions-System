import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";
import { z } from "zod";

export const LoginSchema = z.object({
  username: z.string().min(3).max(64).trim(),
  password: z.string().min(6).max(128),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(64)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}
