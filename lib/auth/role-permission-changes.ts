import { PERMISSION_CATALOG, permissionPageCode } from "./permissions.ts";

/** A page switch cascades to its non-core descendants; a child never changes siblings. */
function permissionDescendants(permission: string) {
  return PERMISSION_CATALOG.some((item) => item.code === permission && item.kind === "PAGE")
    ? PERMISSION_CATALOG.filter((item) => item.code !== permission && !item.core
      && (permissionPageCode(item.code) === permission
        || (permission === "customers.view" && ["customers.pool.view", "customers.mine.view"].includes(permissionPageCode(item.code)))))
    : [];
}

export function rolePermissionChanges(permission: string, enabled: boolean) {
  const pageChildren = permissionDescendants(permission);
  return [
    { permission_code: permission, enabled },
    ...pageChildren.map((item) => ({ permission_code: item.code, enabled })),
  ];
}

export function userPermissionChanges(permission: string, effect: "ALLOW" | "DENY" | "INHERIT") {
  return [permission, ...permissionDescendants(permission).map((item) => item.code)]
    .map((permission_code) => ({ permission_code, effect }));
}
