import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { UserStatus } from "@prisma/client";
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

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  @MaxLength(128)
  email?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  // 角色名(如 admin / operator / viewer),service 层按 name 查 roleId
  roleName!: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  @MaxLength(128)
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  roleName?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}

export class UserListQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  roleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}
