import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Permissions, Roles } from "../../common/decorators/auth.decorators";
import {
  CurrentUser,
  JwtUser,
} from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserListQueryDto,
} from "./dto/user-admin.dto";
import { UserAdminService } from "./user-admin.service";

/**
 * 用户管理。
 * - 列表 / 详情 / 更新:`admin` 或 `operator`(operator 实际能否进入需配合 `user:read` / `user:write` 权限)
 * - 创建 / 重置密码:**仅 `admin`**,在方法上覆写 `@Roles('admin')`
 *
 * 注:seed 给 operator 没有任何 `user:*` 权限,因此即使通过 RolesGuard 也会被 PermissionsGuard 拦截。
 * 后续如需放开,在主会话里给 operator.role.permissions 加 `user:read` / `user:write` 即可,代码无需改动。
 */
@Controller("admin/users")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("admin", "operator")
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  @Get()
  @Permissions("user:read")
  list(@Query() query: UserListQueryDto) {
    return this.users.list(query);
  }

  @Get(":id")
  @Permissions("user:read")
  findOne(@Param("id") id: string) {
    return this.users.findById(id);
  }

  @Post()
  @Roles("admin")
  @Permissions("user:write")
  create(@Body() body: CreateUserDto, @CurrentUser() user?: JwtUser) {
    return this.users.create(body, user);
  }

  @Patch(":id")
  @Permissions("user:write")
  update(
    @Param("id") id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.users.update(id, body, user);
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  @Roles("admin")
  resetPassword(
    @Param("id") id: string,
    @Body() body: ResetPasswordDto,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.users.resetPassword(id, body.password, user);
  }
}
