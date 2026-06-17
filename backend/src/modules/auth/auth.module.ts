import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AppEnv } from "../../config/env.schema";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtRefreshStrategy } from "./jwt-refresh.strategy";
import { JwtStrategy } from "./jwt.strategy";
import { RoleService } from "./role.service";
import { UserService } from "./user.service";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt", session: false }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const cfg = config.get("JWT_ACCESS_SECRET", { infer: true }) as string;
        const ttl = config.get("JWT_ACCESS_TTL", { infer: true }) as string;
        return {
          secret: cfg,
          signOptions: { expiresIn: ttl },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserService,
    RoleService,
    JwtStrategy,
    JwtRefreshStrategy,
  ],
  exports: [
    AuthService,
    UserService,
    RoleService,
    JwtStrategy,
    JwtRefreshStrategy,
  ],
})
export class AuthModule {}
