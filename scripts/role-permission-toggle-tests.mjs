import assert from "node:assert/strict";
import { rolePermissionChanges } from "../lib/auth/role-permission-changes.ts";

assert.deepEqual(rolePermissionChanges("orders.cancel", false), [
  { permission_code: "orders.cancel", enabled: false },
]);
assert.deepEqual(rolePermissionChanges("orders.cancel", true), [
  { permission_code: "orders.cancel", enabled: true },
]);
assert.deepEqual(rolePermissionChanges("orders.view", true), [
  { permission_code: "orders.view", enabled: true },
]);
const shutdown = rolePermissionChanges("orders.view", false);
assert.equal(shutdown[0].permission_code, "orders.view");
assert.equal(shutdown[0].enabled, false);
assert.ok(shutdown.some((item) => item.permission_code === "orders.cancel" && !item.enabled));
assert.ok(shutdown.every((item) => item.permission_code.startsWith("orders.")));
assert.equal(new Set(shutdown.map((item) => item.permission_code)).size, shutdown.length);
console.log("Role permission toggle isolation passed.");
