import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";
export const ROLES_KEY = "roles";
export const PERMISSIONS_KEY = "permissions";

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
