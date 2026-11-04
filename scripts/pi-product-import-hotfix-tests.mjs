import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { hasPiProductHeader, parsePiProductRows } from "../lib/pi-product-import.ts";

const template = XLSX.readFile("public/templates/pi-line-import-template.xlsx");
assert.deepEqual(template.SheetNames, ["PI产品明细"]);
const sheet = template.Sheets["PI产品明细"];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
assert.equal(sheet["!ref"], "A1:H501");
assert.deepEqual(rows[0], ["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "成本单价（CNY） *", "销售单价（CNY或USD） *", "数量 *"]);
assert.equal(hasPiProductHeader(rows), true);
rows[1] = ["LCD", "IPH", "17 Pro", "OLED", "", "¥80", "$20", "3"];
rows[2] = ["电池", "IPH", "14", "原装", "无包装", "￥20", "¥30", "2"];
const imported = parsePiProductRows(rows, 1 / 6.56, "USD");
assert.equal(imported.length, 2);
assert.deepEqual(imported.map((line) => [line.item_name, line.brand, line.model, line.quality, line.description, line.estimated_unit_cost_cny, line.unit_price_cny, line.unit_price_payment, line.quantity]), [
  ["LCD", "IPH", "17 Pro", "OLED", "", "80.00", "131.20", "20.00", "3"],
  ["电池", "IPH", "14", "原装", "无包装", "20.00", "30.00", "4.57", "2"],
]);
assert.deepEqual(parsePiProductRows(rows.map((row) => row.map(String)), 1 / 6.56, "USD"), imported, "粘贴与文件导入须得到相同字段和金额");
const pastedTemplate = rows.map((row) => row.join("\t")).join("\n");
assert.deepEqual(parsePiProductRows(pastedTemplate.split(/\r?\n/).map((line) => line.split("\t")), 1 / 6.56, "USD"), imported, "真实剪贴板 TSV 解析须与上传模板完全一致");
assert.equal(imported.reduce((sum, line) => sum + Number(line.unit_price_cny) * Number(line.quantity), 0).toFixed(2), "453.60");
assert.equal(imported.reduce((sum, line) => sum + Number(line.unit_price_payment) * Number(line.quantity), 0).toFixed(2), "69.14");
const incomplete = parsePiProductRows([rows[0], ["LCD", "", "17", "", "", "¥80", "$20", "3"], ["电池", "IPH", "14", "原装", "", "", "", ""]], 1 / 6.56, "USD");
assert.equal(incomplete.length, 2, "缺少必填项的产品仍须进入明细供用户补齐");
assert.deepEqual([incomplete[0].source_row, incomplete[0].brand, incomplete[0].quality, incomplete[0].unit_price_cny], [2, "", "", "131.20"]);
assert.deepEqual([incomplete[1].source_row, incomplete[1].estimated_unit_cost_cny, incomplete[1].unit_price_cny, incomplete[1].quantity], [3, "", "", ""]);
assert.throws(() => parsePiProductRows([rows[0], ["LCD", "IPH", "17", "OLED", "", "¥80", "$20", "2.5"]], 1 / 6.56, "USD"), /第2行数量须填写正整数/);
assert.throws(() => parsePiProductRows(rows, 1 / 6.56, "EUR"), /含美元价格/);
const formSource = readFileSync("components/pi-order-form.tsx", "utf8");
assert.match(formSource, /importRows\(productSheet\.rows\)/, "Excel button must use the tested parser");
assert.match(formSource, /importRows\(\(await navigator\.clipboard\.readText\(\)\)\.split\(\/\\r\?\\n\/\)\.map\(\(line\) => line\.split\("\\t"\)\)\)/, "paste button must pass real clipboard TSV through the tested parser");
assert.match(formSource, /catch \(cause\) \{ setError\(cause instanceof Error \? cause\.message : "读取剪贴板失败"\); \}/, "paste errors must be shown to the user");
assert.match(formSource, /以下信息待补全/, "incomplete imported rows must show the user their source row and missing fields");
assert.match(formSource, /const invalidRow = items\.findIndex/, "saving and submitting must still block incomplete lines");

const sourcePath = process.argv[2];
if (sourcePath) {
  const source = XLSX.readFile(sourcePath);
  const sourceRows = XLSX.utils.sheet_to_json(source.Sheets[source.SheetNames[0]], { header: 1, defval: "", raw: false });
  assert.equal(hasPiProductHeader(sourceRows), true);
  const validSourceRows = sourceRows.slice(0, 35);
  const validSource = parsePiProductRows(validSourceRows, 1 / 6.56, "USD");
  const pastedSource = validSourceRows.map((row) => row.join("\t")).join("\r\n");
  assert.deepEqual(parsePiProductRows(pastedSource.split(/\r?\n/).map((line) => line.split("\t")), 1 / 6.56, "USD"), validSource, "PI 原始单据复制产品区域后粘贴须与 Excel 导入一致");
  assert.equal(validSource.length, 17);
  assert.deepEqual([validSource[0].item_name, validSource[0].brand, validSource[0].model, validSource[0].quality, validSource[0].estimated_unit_cost_cny, validSource[0].unit_price_cny, validSource[0].quantity],
    ["glass+oca", "IPH", "13pm", "original", "23.00", "28.00", "2"]);
  const fullSource = parsePiProductRows(sourceRows, 1 / 6.56, "USD");
  const sourceRow36 = fullSource.find((line) => line.source_row === 36);
  assert.ok(sourceRow36, "原文件第36行不能因缺少必填项被丢弃");
  assert.equal(sourceRow36.brand, "");
  assert.equal(sourceRow36.model, "");
  assert.ok(fullSource.length > validSource.length, "完整单据应导入第36行及其余产品");
}
console.log("PI product import hotfix tests passed");
