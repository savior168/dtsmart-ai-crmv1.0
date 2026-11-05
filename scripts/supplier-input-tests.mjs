import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSupplierInput } from "../lib/suppliers/input.ts";
import { matchActiveSupplierCode } from "../lib/suppliers/match-code.ts";

const cash = parseSupplierInput({
  legacy_code: "1006", main_products: "LCD", settlement_cycle: "CASH",
});
assert.equal(cash.system_code, "1006", "已有代码的现金结供应商必须沿用原始代码");
assert.equal(cash.legacy_code, "1006", "历史代码必须原样保留");
assert.equal(cash.settlement_days, null);
assert.equal(parseSupplierInput({ main_products: "LCD", settlement_cycle: "CASH" }).system_code, null,
  "仅无代码现金结供应商才需要自动生成 CASH 编号");

const monthly = parseSupplierInput({
  legacy_code: "008", main_products: "电池", settlement_cycle: "MONTHLY",
});
assert.equal(monthly.system_code, "008", "保留账期供应商前导零代码");
assert.equal(monthly.short_name, null, "供应商名称为选填项");
assert.equal(parseSupplierInput({ settlement_cycle: "CASH", main_products: "LCD" }, false).is_active, false,
  "修改停用供应商时未明确启用不得意外重新启用");
assert.equal(parseSupplierInput({ settlement_cycle: "CASH", main_products: "LCD", is_active: true }, false).is_active, true,
  "明确重新启用停用供应商应生效");
assert.throws(() => parseSupplierInput({ settlement_cycle: "CASH", main_products: "LCD", is_active: "false" }), /启用状态/);

assert.throws(() => parseSupplierInput({ settlement_cycle: "MONTHLY", main_products: "电池" }), /代码/);
assert.throws(() => parseSupplierInput({ settlement_cycle: "UNSET", main_products: "电池" }), /商务条件/);
assert.throws(() => parseSupplierInput({ settlement_cycle: "CASH" }), /主供产品/);
assert.throws(() => parseSupplierInput({ settlement_cycle: "NET_DAYS", settlement_days: 0, main_products: "LCD", legacy_code: "123" }), /天数/);
assert.equal(parseSupplierInput({ settlement_cycle: "NET_DAYS", settlement_days: 15, main_products: "LCD", system_code: "A15" }).settlement_days, 15);
const supplierRoute = readFileSync(new URL("../app/api/suppliers/route.ts", import.meta.url), "utf8");
assert.match(supplierRoute, /codeOnly \? "id,system_code,settlement_cycle,is_active" : "\*"/,
  "仓库员代码列表必须返回启用状态，但不能泄露供应商名称");
assert.match(supplierRoute, /error\.code === "23505"[\s\S]*status: 409/,
  "并发重复建档必须返回可操作的冲突提示，而不是暴露数据库错误");
const activeSuppliers = [{ id: "a", system_code: "1006" }, { id: "b", system_code: "CASH-000001" }];
assert.equal(matchActiveSupplierCode(activeSuppliers, " 1006 ")?.id, "a");
assert.equal(matchActiveSupplierCode(activeSuppliers, "cash-000001")?.id, "b");
assert.equal(matchActiveSupplierCode(activeSuppliers, "1007"), undefined,
  "不存在的代码不能映射成供应商档案或登记回货");
const stockView = readFileSync(new URL("../components/stock-order-detail-view.tsx", import.meta.url), "utf8");
assert.match(stockView, /在此新增供应商档案/);
assert.match(stockView, /selectedSupplier\.id !== receiptDraft\.supplierId/);
console.log("supplier input validation tests passed");
