import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseImportFile, mapImportRow } from "../lib/import-parser.ts";
import { postgrestContains } from "../lib/postgrest-search.ts";

const rows = [
  ["名称", "国家", "完整号码", "邮箱"],
  ["测试客户", "德国", "+49 30 123456", "Sales@Example.com"],
];
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "客户");

for (const [filename, bookType] of [["customers.xlsx", "xlsx"], ["customers.xls", "biff8"]]) {
  const output = XLSX.write(workbook, { type: "array", bookType });
  const parsed = await parseImportFile(new File([output], filename));
  assert.equal(parsed.length, 1, `${filename} 应读取一条数据`);
  const mapped = mapImportRow(parsed[0]);
  assert.equal(mapped.company_name, "测试客户");
  assert.equal(mapped.phone, "+49 30 123456");
  assert.equal(mapped.email, "Sales@Example.com");
}

const specialName = "FLIX - Serwis Apple Warszawa | Serwis iPhone, Serwis MacBook | Wymiana szybki";
const pattern = postgrestContains(specialName);
assert.equal(pattern.startsWith('"%'), true);
assert.equal(pattern.endsWith('%"'), true);
assert.equal(pattern.includes(specialName), true, "特殊字符必须完整保留在同一个PostgREST字符串操作数中");

const customerRoute = readFileSync(resolve("app/api/customers/route.ts"), "utf8");
assert.match(customerRoute, /postgrestContains\(search\)/, "客户搜索必须使用PostgREST安全引用");
assert.doesNotMatch(customerRoute, /const deleted =/, "客户查询不得再暴露历史软删除记录");

const importRoute = readFileSync(resolve("app/api/import/route.ts"), "utf8");
assert.doesNotMatch(importRoute, /from\("customers"\)[\s\S]{0,300}\.is\("deleted_at", null\)/, "导入身份检查不能忽略历史客户身份");

const appShell = readFileSync(resolve("components/app-shell.tsx"), "utf8");
assert.doesNotMatch(appShell, /setProfile\(\{ name: "当前用户"[\s\S]{0,120}loadProfile\(\)/, "菜单切换不得重置并闪烁用户资料");

const migration = readFileSync(resolve("supabase/migrations/202608260001_customer_import_identity_guard.sql"), "utf8");
assert.match(migration, /HISTORICAL_SOFT_DELETE/);
assert.match(migration, /DUPLICATE_CUSTOMER/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /before insert on public\.customers/);

console.log("导入、特殊字符搜索、永久删除与用户资料切换回归测试通过。");
