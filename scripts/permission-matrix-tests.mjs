import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluatePermission, isRetiredPermission, PERMISSION_CATALOG, permissionPageCode } from "../lib/auth/permissions.ts";

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
  ["跟单员未授权时不能修改备货", account("ORDER_CLERK", ["stock.view"]), "stock.update", false],
  ["跟单员明确授权后可修改备货", account("ORDER_CLERK", ["stock.view", "stock.update"]), "stock.update", true],
  ["跟单员明确授权后可编辑客户", account("ORDER_CLERK", ["customers.view", "customers.edit"]), "customers.edit", true],
  ["跟单员未授权时不能取消PI", account("ORDER_CLERK", ["orders.view"]), "orders.cancel", false],
  ["管理员明确授权后跟单员只能取消本人创建的PI", account("ORDER_CLERK", ["orders.view", "orders.cancel"]), "orders.cancel", true],
  ["跟单员未授权时不能预览备货", account("ORDER_CLERK", ["stock.view"]), "stock.preview", false],
  ["管理员明确授权后跟单员可预览有权查看的备货", account("ORDER_CLERK", ["stock.view", "stock.preview"]), "stock.preview", true],
  ["主管默认不能读下属", account("SUPERVISOR", ["customers.view", "customers.data_all"]), "customers.data_all", false],
  ["主管开启后可读下属", account("SUPERVISOR", ["customers.view", "customers.data_all"], { supervisor_can_view_subordinates: true }), "customers.data_all", true],
  ["主管开启数据开关但页面仍关闭", account("SUPERVISOR", ["customers.data_all"], { supervisor_can_view_subordinates: true }), "customers.data_all", false],
  ["仓库员无PI页面不能预览", account("WAREHOUSE", ["orders.preview"]), "orders.preview", false],
  ["财务员可查看对账", account("FINANCE", ["supplier.reconciliation.view"]), "supplier.reconciliation.view", true],
  ["财务员默认不能维护供应商", account("FINANCE", ["suppliers.view"]), "suppliers.manage", false],
  ["管理员可单独授权财务员维护供应商", account("FINANCE", ["suppliers.view", "suppliers.manage"]), "suppliers.manage", true],
  ["财务员未授权时不可读取客户", account("FINANCE", []), "customers.view", false],
  ["财务员明确授权后可读取客户", account("FINANCE", ["customers.view"]), "customers.view", true],
  ["财务员明确授权后可读取销售PI", account("FINANCE", ["orders.view"]), "orders.view", true],
  ["财务员不可取得管理员核心权限", account("FINANCE", ["system.users.view"]), "system.users.view", false],
  ["费用中心单独授权后可查看", account("SALES", ["costs.view"]), "costs.view", true],
  ["费用中心导出须另行授权", account("SALES", ["costs.view"]), "costs.export", false],
  ["费用中心导出需页面与按钮双授权", account("SALES", ["costs.view", "costs.export"]), "costs.export", true],
  ["商品主档维护可由管理员单独授权", account("WAREHOUSE", ["products.view", "products.manage"]), "products.manage", true],
  ["商品分类维护可由管理员单独授权", account("WAREHOUSE", ["products.categories.view", "products.categories.manage"]), "products.categories.manage", true],
  ["商品维护未授权时不能访问", account("WAREHOUSE", ["products.view"]), "products.manage", false],
  ["汇率设置可只读授权", account("SUPERVISOR", ["pi.rates.view"]), "pi.rates.view", true],
  ["汇率维护必须额外授权", account("SUPERVISOR", ["pi.rates.view"]), "pi.rates.manage", false],
  ["汇率维护明确授权后生效", account("SUPERVISOR", ["pi.rates.view", "pi.rates.manage"]), "pi.rates.manage", true],
  ["收款账户可只读授权", account("SUPERVISOR", ["pi.accounts.view"]), "pi.accounts.view", true],
  ["收款账户维护必须额外授权", account("SUPERVISOR", ["pi.accounts.view"]), "pi.accounts.manage", false],
  ["收款账户维护明确授权后生效", account("SUPERVISOR", ["pi.accounts.view", "pi.accounts.manage"]), "pi.accounts.manage", true],
  ["财务员获授权后可查看汇率", account("FINANCE", ["pi.rates.view"]), "pi.rates.view", true],
  ["财务员获授权后可维护汇率", account("FINANCE", ["pi.rates.view", "pi.rates.manage"]), "pi.rates.manage", true],
  ["财务员获授权后可查看收款账户", account("FINANCE", ["pi.accounts.view"]), "pi.accounts.view", true],
  ["财务员获授权后可维护收款账户", account("FINANCE", ["pi.accounts.view", "pi.accounts.manage"]), "pi.accounts.manage", true],
  ["仅预览导入权限不能绕过导入", account("SALES", ["imports.view"]), "imports.create", false],
  ["内部报价规则不可下放", account("SALES", ["pricebooks.rules.view"]), "pricebooks.rules.view", false],
  ["商品分类浏览独立授权", account("SALES", ["products.categories.view"]), "products.categories.view", true],
  ["主管实际利润需要报表页及独立授权", account("SUPERVISOR", ["reports.view", "reports.actual_profit.view"]), "reports.actual_profit.view", true],
  ["主管撤销实际利润权限后不可见", account("SUPERVISOR", ["reports.view"]), "reports.actual_profit.view", false],
  ["销售员只有报表页不可见实际利润", account("SALES", ["reports.view"]), "reports.actual_profit.view", false],
  ["仓库员不能仅凭实际利润权限绕过报表页", account("WAREHOUSE", ["reports.actual_profit.view"]), "reports.actual_profit.view", false],
];
for (const [label, user, permission, expected] of cases) {
  assert.equal(evaluatePermission(user, permission), expected, label);
}
for (const item of PERMISSION_CATALOG) {
  if (item.kind === "PAGE") continue;
  const page = permissionPageCode(item.code);
  assert.ok(PERMISSION_CATALOG.some((candidate) => candidate.code === page && candidate.kind === "PAGE"), `${item.code} 缺少归属页面`);
}
for (const item of PERMISSION_CATALOG) {
  const page = permissionPageCode(item.code);
  for (const role of ["SALES", "SUPERVISOR", "ORDER_CLERK", "WAREHOUSE"]) {
    const granted = account(role, [item.code, page], { supervisor_can_view_subordinates: true });
    if (item.core || PERMISSION_CATALOG.some((candidate) => candidate.code === page && candidate.core)) {
      assert.equal(evaluatePermission(granted, item.code), false, `${role} 不得获得管理员专属权限 ${item.code}`);
    }
    if (item.code !== page) {
      assert.equal(evaluatePermission(account(role, [item.code], { supervisor_can_view_subordinates: true }), item.code), false,
        `${role} 关闭所属页面后不得使用 ${item.code}`);
    }
  }
}
const migration = readFileSync(new URL("../supabase/migrations/20261102060002_finance_role_supplier_permissions.sql", import.meta.url), "utf8");
const dbPages = [...migration.matchAll(/when p_permission like '([^']+)%' then '([^']+)'/g)]
  .map((match) => ({ prefix: match[1], page: match[2] }));
for (const item of PERMISSION_CATALOG.filter((entry) => !isRetiredPermission(entry.code))) {
  const dbPage = dbPages.find((entry) => item.code.startsWith(entry.prefix))?.page || item.code;
  assert.equal(dbPage, permissionPageCode(item.code), `${item.code} 的数据库页面权限映射与应用不一致`);
}
const coreSection = migration.match(/if p_permission=any\(array\[([\s\S]*?)\]\) or page_code=any\(array\[/)?.[1];
assert.ok(coreSection, "database permission guard must list admin-only actions");
const dbCore = [...coreSection.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
const appCore = PERMISSION_CATALOG.filter((item) => item.core).map((item) => item.code).sort();
assert.deepEqual(dbCore, appCore, "数据库管理员专属权限清单必须与应用一致");
const corePageSection = migration.match(/or page_code=any\(array\[([\s\S]*?)\]\) then return false/)?.[1];
assert.ok(corePageSection, "database permission guard must block children of admin-only pages");
const dbCorePages = [...corePageSection.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
const appCorePages = PERMISSION_CATALOG.filter((item) => item.core && item.kind === "PAGE").map((item) => item.code).sort();
assert.deepEqual(dbCorePages, appCorePages, "数据库管理员专属页面清单必须与应用一致");
console.log(`Permission matrix passed: ${cases.length} focused cases plus ${PERMISSION_CATALOG.length} catalog entries across four non-admin roles.`);
