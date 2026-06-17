import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";
import {
  CurrentUser,
  JwtUser,
} from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/auth.decorators";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { LoginResponse, RefreshResponse } from "./dto/auth-response.dto";

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(4096)
  refreshToken!: string;
}

@Controller({ path: "admin/auth" })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.username, dto.password);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<RefreshResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Get("me")
  me(@CurrentUser() user: JwtUser) {
    return this.auth.getMe(user);
  }
}
