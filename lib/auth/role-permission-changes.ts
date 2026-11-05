import { PERMISSION_CATALOG, permissionPageCode } from "./permissions.ts";

/** Parent shutdown is the only operation allowed to change child switches. */
export function rolePermissionChanges(permission: string, enabled: boolean) {
  const pageChildren = permissionPageCode(permission) === permission && !enabled
    ? PERMISSION_CATALOG.filter((item) => item.code !== permission && permissionPageCode(item.code) === permission && !item.core)
    : [];
  return [
    { permission_code: permission, enabled },
    ...pageChildren.map((item) => ({ permission_code: item.code, enabled: false })),
  ];
}
