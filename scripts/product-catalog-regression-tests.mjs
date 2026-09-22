import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseProductWorkbook, validateNormalizedProduct } from "../lib/product-import.ts";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["SKU", "商品名称", "品牌", "型号", "品质", "成本单价", "美元售价"],
  ["LCD-IP15-OLED", "iPhone 15 OLED屏幕", "Apple", "iPhone 15", "OLED", 320, 58.5],
]), "标准明细");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["官方屏幕价格"],
  ["型号", "原装", "拆机"],
  ["iPhone 14", 420, 380],
]), "官方屏幕-电池");
const parsed = parseProductWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
assert.equal(parsed.sheet_count, 2, "必须逐个工作表解析并对账");
assert.ok(parsed.source_row_count >= 5, "必须记录原始非空行数");
const standard = parsed.candidates.find((row) => row.normalized_data.sku === "LCD-IP15-OLED");
assert.ok(standard, "标准明细必须识别SKU候选");
assert.equal(standard.status, "VALID", "完整标准明细应直接校验通过");
assert.equal(standard.normalized_data.procurement_cny, 320, "人民币采购价必须保持数值精度");
assert.equal(standard.normalized_data.sale_usd, 58.5, "美元销售参考价必须保持数值精度");
const matrix = parsed.candidates.find((row) => row.source_sheet === "官方屏幕-电池");
assert.ok(matrix, "矩阵价格表必须保留候选而非静默丢弃");
assert.equal(matrix.status, "REVIEW", "矩阵候选在缺少SKU时必须进入核对区，禁止猜测发布");
assert.ok(matrix.source_cell, "每个候选必须保留原单元格定位");

const invalid = validateNormalizedProduct({ name_zh: "测试商品", procurement_cny: 10 });
assert.ok(invalid.issues.some((issue) => issue.includes("SKU")), "缺少SKU必须被拦截");
const valid = validateNormalizedProduct({ sku: "TEST-001", name_zh: "测试商品", procurement_cny: 10, minimum_order_quantity: 1 });
assert.deepEqual(valid.issues, [], "完整商品候选应通过校验");

const permissions = read("lib/auth/permissions.ts");
for (const code of ["products.view","products.manage","pricebooks.view","pricebooks.sales.view","pricebooks.cost.total.view","pricebooks.cost.view","pricebooks.manage","pricebooks.import","pricebooks.publish"]) {
  assert.match(permissions, new RegExp(code.replaceAll(".", "\\.")), `权限目录缺少 ${code}`);
}
const migration = read("supabase/migrations/202609220002_product_catalog_pricebook.sql");
assert.match(migration, /product_import_batches[\s\S]*file_sha256[\s\S]*unique\(file_sha256\)/, "相同源文件必须幂等去重");
assert.match(migration, /status in \('REVIEW','ERROR'\)[\s\S]*仍有待处理或错误数据，不能发布/, "待核对或错误行必须阻止发布");
assert.match(migration, /source_import_row_id[\s\S]*source_note/, "价格必须追溯到导入来源");
assert.match(migration, /price_kind in \('PROCUREMENT','PACKAGING','OTHER_COST','SALE_REFERENCE'\)/, "完整成本必须拆分采购、包装和其他成本");
assert.match(migration, /role_code = 'SALES'[\s\S]*pricebooks\.cost\.total\.view/, "销售员默认只能查看完整成本合计");
assert.match(migration, /role_code = 'WAREHOUSE'[\s\S]*pricebooks\.cost\.view/, "仓库员默认可查看成本拆分");
assert.match(migration, /price_kind='SALE_REFERENCE' and public\.current_user_has_business_permission\('pricebooks\.sales\.view'\)/, "销售参考价必须单独鉴权");
assert.match(migration, /if target\.status = 'PUBLISHED'[\s\S]*idempotent/, "重复发布必须幂等");

const shell = read("components/app-shell.tsx");
assert.match(shell, /label: "商品中心"[\s\S]*商品资料[\s\S]*产品价格表/, "商品中心必须使用规范二级菜单");
for (const path of ["components/product-catalog-view.tsx","components/product-pricebook-view.tsx","components/product-import-view.tsx","components/product-import-review-view.tsx"]) {
  const source = read(path);
  assert.match(source, /AppPagination|AppDialog|AppFilterBar/, `${path} 必须复用现有统一组件`);
  assert.doesNotMatch(source, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, `${path} 禁止使用浏览器原生弹框`);
}

console.log("商品资料、产品价格表、安全导入和权限回归测试通过。");
