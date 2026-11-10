import assert from "node:assert/strict";
import { rolePermissionChanges, userPermissionChanges } from "../lib/auth/role-permission-changes.ts";

assert.deepEqual(rolePermissionChanges("orders.cancel", false), [
  { permission_code: "orders.cancel", enabled: false },
]);
assert.deepEqual(rolePermissionChanges("orders.cancel", true), [
  { permission_code: "orders.cancel", enabled: true },
]);
const activation = rolePermissionChanges("orders.view", true);
assert.ok(activation.some((item) => item.permission_code === "orders.cancel" && item.enabled));
assert.ok(activation.every((item) => item.permission_code.startsWith("orders.")));
const shutdown = rolePermissionChanges("orders.view", false);
assert.equal(shutdown[0].permission_code, "orders.view");
assert.equal(shutdown[0].enabled, false);
assert.ok(shutdown.some((item) => item.permission_code === "orders.cancel" && !item.enabled));
assert.ok(shutdown.every((item) => item.permission_code.startsWith("orders.")));
assert.equal(new Set(shutdown.map((item) => item.permission_code)).size, shutdown.length);
const customerShutdown = rolePermissionChanges("customers.view", false);
assert.ok(customerShutdown.some((item) => item.permission_code === "customers.pool.view" && !item.enabled));
assert.ok(customerShutdown.some((item) => item.permission_code === "customers.mine.view" && !item.enabled));
assert.ok(customerShutdown.some((item) => item.permission_code === "customers.claim" && !item.enabled));
assert.ok(customerShutdown.some((item) => item.permission_code === "customers.edit" && !item.enabled));
const poolActivation = rolePermissionChanges("customers.pool.view", true);
assert.ok(poolActivation.some((item) => item.permission_code === "customers.claim" && item.enabled));
assert.ok(poolActivation.every((item) => !["customers.mine.view", "customers.edit"].includes(item.permission_code)));
assert.ok(rolePermissionChanges("customers.view", true).some((item) => item.permission_code === "customers.mine.view" && item.enabled));
assert.ok(userPermissionChanges("customers.view", "DENY").some((item) => item.permission_code === "customers.claim" && item.effect === "DENY"));
assert.ok(userPermissionChanges("customers.view", "ALLOW").every((item) => item.effect === "ALLOW"));
assert.deepEqual(userPermissionChanges("customers.edit", "DENY"), [{ permission_code: "customers.edit", effect: "DENY" }]);
assert.deepEqual(userPermissionChanges("customers.mine.view", "ALLOW").some((item) => item.permission_code === "customers.view"), false,
  "单独开启客户子页面不得擅自开启客户总权限");
assert.deepEqual(rolePermissionChanges("customers.edit", true), [{ permission_code: "customers.edit", enabled: true }],
  "最后一个子权限开启也不能自动扩大父级页面权限");
console.log("Role permission toggle isolation passed.");
