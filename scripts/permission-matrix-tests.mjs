import assert from "node:assert/strict";
import { evaluatePermission, PERMISSION_CATALOG, permissionPageCode } from "../lib/auth/permissions.ts";

const account = (role, permissions, extras = {}) => ({ role, permissions, ...extras });
const cases = [
  ["管理员持有核心权限", account("ADMIN", []), "system.users.manage", true],
  ["销售员无核心权限", account("SALES", ["system.users.view", "system.users.manage"]), "system.users.manage", false],
  ["销售员有页面和创建权限", account("SALES", ["orders.view", "orders.create"]), "orders.create", true],
  ["关闭页面后不能创建", account("SALES", ["orders.create"]), "orders.create", false],
  ["预览不隐含导出", account("SALES", ["orders.view", "orders.preview"]), "orders.export", false],
  ["导出不隐含预览", account("SALES", ["orders.view", "orders.export"]), "orders.preview", false],
  ["关闭备货页后不能预览", account("SALES", ["stock.preview"]), "stock.preview", false],
  ["备货预览不隐含导出", account("SALES", ["stock.view", "stock.preview"]), "stock.export", false],
  ["跟单员可读全部PI", account("ORDER_CLERK", ["orders.view", "orders.data_all"]), "orders.data_all", true],
  ["跟单员不能修改备货", account("ORDER_CLERK", ["stock.view", "stock.update"]), "stock.update", false],
  ["跟单员不能编辑客户", account("ORDER_CLERK", ["customers.view", "customers.edit"]), "customers.edit", false],
  ["跟单员不能取消PI", account("ORDER_CLERK", ["orders.view", "orders.cancel"]), "orders.cancel", false],
  ["主管默认不能读下属", account("SUPERVISOR", ["customers.view", "customers.data_all"]), "customers.data_all", false],
  ["主管开启后可读下属", account("SUPERVISOR", ["customers.view", "customers.data_all"], { supervisor_can_view_subordinates: true }), "customers.data_all", true],
  ["主管开启数据开关但页面仍关闭", account("SUPERVISOR", ["customers.data_all"], { supervisor_can_view_subordinates: true }), "customers.data_all", false],
  ["仓库员无PI页面不能预览", account("WAREHOUSE", ["orders.preview"]), "orders.preview", false],
  ["仅预览导入权限不能绕过导入", account("SALES", ["imports.view"]), "imports.create", false],
  ["内部报价规则不可下放", account("SALES", ["pricebooks.rules.view"]), "pricebooks.rules.view", false],
  ["商品分类浏览独立授权", account("SALES", ["products.categories.view"]), "products.categories.view", true],
];
for (const [label, user, permission, expected] of cases) {
  assert.equal(evaluatePermission(user, permission), expected, label);
}
for (const item of PERMISSION_CATALOG) {
  if (item.kind === "PAGE") continue;
  const page = permissionPageCode(item.code);
  assert.ok(PERMISSION_CATALOG.some((candidate) => candidate.code === page && candidate.kind === "PAGE"), `${item.code} 缺少归属页面`);
}
console.log(`Permission matrix passed: ${cases.length} role/action cases and ${PERMISSION_CATALOG.length} catalog entries.`);
