import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { QUOTE_CURRENCY_CODES } from "../lib/currencies.ts";
import { derivePiCnyRate, detectPiPaymentCurrency, hasPiProductHeader, parsePiClipboardTsv, parsePiProductRows } from "../lib/pi-product-import.ts";

const template = XLSX.readFile("public/templates/pi-line-import-template.xlsx");
assert.deepEqual(template.SheetNames, ["PI产品明细"]);
const sheet = template.Sheets["PI产品明细"];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
assert.equal(sheet["!ref"], "A1:H501");
assert.deepEqual(rows[0], ["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "成本单价（CNY） *", "销售单价（CNY或付款币种） *", "数量 *"]);
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
assert.throws(() => parsePiProductRows(rows, 1 / 6.56, "EUR"), /价格币种与PI付款币种 EUR 不一致/);
const audRows = [
  ["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "成本单价（CNY） *", "销售单价（AUD） *", "数量 *"],
  ["LCD", "FOR SAM", "S21", "OLED", "BLACK", "¥282", "AUD 100", "2"],
];
const audImported = parsePiProductRows(audRows, 1 / 4.54, "AUD");
assert.deepEqual([audImported[0].unit_price_cny, audImported[0].unit_price_payment, audImported[0].unit_price_source], ["454.00", "100.00", "PAYMENT"]);
assert.deepEqual(parsePiProductRows(audRows.map((row) => row.map(String)), 1 / 4.54, "AUD"), audImported, "AUD Excel 与粘贴金额一致");
assert.equal(detectPiPaymentCurrency([["PAYMENT/ METHOD :", "", "AUD"], ...audRows]), "AUD");
assert.equal(detectPiPaymentCurrency([["LCD", "FOR SAM", "S21", "OLED", "BLACK", "¥282", "AUD 100", "2"]]), "AUD", "no-header pasted product row infers AUD from its price token");
assert.equal(detectPiPaymentCurrency([["LCD", "FOR SAM", "S21", "OLED", "BLACK", "￥282", "CNY 100", "2"]]), "CNY", "CNY and full-width RMB symbol map to CNY");
assert.equal(detectPiPaymentCurrency([["LCD", "FOR SAM", "S21", "OLED", "BLACK", "¥282", "€100", "2"]]), "EUR");
assert.equal(detectPiPaymentCurrency([["LCD", "FOR SAM", "S21", "OLED", "BLACK", "¥282", "£100", "2"]]), "GBP");
assert.equal(detectPiPaymentCurrency([["LCD", "FOR SAM", "S21", "OLED", "BLACK", "¥282", "A$100", "2"]]), "AUD");
assert.equal(detectPiPaymentCurrency([["LCD", "FOR SAM", "S21", "OLED", "BLACK", "¥282", "AU$100", "2"]]), "AUD");
assert.equal(detectPiPaymentCurrency([["LCD", "FOR SAM", "S21", "OLED", "BLACK", "￥282", "RMB 100", "2"]]), "CNY");
const pastedInvoiceRows = [[1, "LCD", "", "FOR SAM", "S21", "1:1 size Soft oled,WF", "BLACK", "", "AUD 100", 1, "AUD 100", "¥282"]];
assert.equal(detectPiPaymentCurrency(pastedInvoiceRows), "AUD", "PI产品区域原样复制时从单价字段识别币种");
const pastedInvoice = parsePiProductRows(pastedInvoiceRows, 1 / 4.54, "AUD");
assert.deepEqual([pastedInvoice[0].item_name, pastedInvoice[0].brand, pastedInvoice[0].model, pastedInvoice[0].quality, pastedInvoice[0].description, pastedInvoice[0].unit_price_cny, pastedInvoice[0].unit_price_payment, pastedInvoice[0].quantity, pastedInvoice[0].estimated_unit_cost_cny], ["LCD", "FOR SAM", "S21", "1:1 size Soft oled,WF", "BLACK", "454.00", "100.00", "1", "282.00"]);
assert.throws(() => detectPiPaymentCurrency([["LCD", "FOR SAM", "S21", "OLED", "BLACK", "$282", "AUD 100", "2"]]), /混用/);
const dualRows = [
  ["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "成本单价（CNY） *", "Unit Price (CNY)", "Unit Price (AUD)", "数量 *"],
  ["LCD", "FOR SAM", "S21", "OLED", "BLACK", "¥282", "¥454", "AUD 100", "2"],
  ["LCD", "FOR SAM", "S22", "OLED", "BLACK", "¥200", "¥227", "AUD 50", "1"],
];
assert.equal(derivePiCnyRate(dualRows, "AUD"), 4.54);
assert.equal(parsePiProductRows(dualRows, 1 / 4.54, "AUD")[0].unit_price_payment, "100.00");
const partiallyQuotedDualRows = [dualRows[0], ["LCD", "FOR SAM", "S20", "OLED", "BLACK", "¥80", "", "AUD 25", "1"], dualRows[1]];
assert.equal(derivePiCnyRate(partiallyQuotedDualRows, "AUD"), 4.54, "未填完整双币种报价的行不应阻止其他完整行反推汇率");
assert.deepEqual(parsePiProductRows(partiallyQuotedDualRows, 1 / 4.54, "AUD").map(({ model, unit_price_cny, unit_price_payment, quantity }) => [model, unit_price_cny, unit_price_payment, quantity]),
  [["S20", "113.50", "25.00", "1"], ["S21", "454.00", "100.00", "2"]],
  "缺一币种单价的行也应保留并按已推导汇率补算另一币种");
assert.throws(() => derivePiCnyRate([dualRows[0], dualRows[1], [...dualRows[2].slice(0, 7), "AUD 49", "1"]], "AUD"), /汇率.*不一致/);
const copiedDualCurrencyRows = [
  ["Items", "Brand", "Models", "Quality", "Description", "Unit Price (CNY)", "Unit Price (AUD)", "", "Quantity", "Amount (CNY)", "Amount (AUD)", "成本"],
  ["LCD", "FOR SAM", "S21", "1:1 size Soft oled,WF", "BLACK", "￥314.62", "AUD 69.30", "", "1", "￥314.62", "AUD 69.30", "￥282.00"],
  ["LCD", "FOR SAM", "S21 plus", "big size Soft oled,WF", "BLACK", "￥314.62", "AUD 69.30", "", "2", "￥629.24", "AUD 138.60", "￥282.00"],
  ["LCD", "FOR SAM", "S21 ultra", "big size Soft oled,WF", "BLACK", "￥355.03", "AUD 78.20", "", "2", "￥710.06", "AUD 156.40", "￥318.00"],
  ["LCD", "FOR SAM", "S22", "1:1 size Soft oled,WF", "BLACK", "￥505.76", "AUD 111.40", "", "1", "￥505.76", "AUD 111.40", "￥453.00"],
  ["LCD", "FOR SAM", "S22 ultra", "big size Soft oled,WF", "BLACK", "￥355.03", "AUD 78.20", "", "3", "￥1,065.08", "AUD 234.60", "￥318.00"],
  ["LCD", "FOR SAM", "Note 20 ultra", "1:1 size Soft oled,WF", "Burgundy", "￥309.17", "AUD 68.10", "", "1", "￥309.17", "AUD 68.10", "￥277.00"],
  ["LCD", "FOR SAM", "Xcover pro", "ORG", "BLACK", "￥111.23", "AUD 24.50", "", "3", "￥333.69", "AUD 73.50", "￥100.00"],
  ["LCD", "FOR SAM", "A04s", "ORG", "BLACK", "￥36.32", "AUD 8.00", "", "2", "￥72.64", "AUD 16.00", "￥31.00"],
  ["Backglass", "FOR OPPO", "Reno12 5G CPH 2625", "ORG", "BLACK", "￥108.96", "AUD 24.00", "", "1", "￥108.96", "AUD 24.00", "￥97.00"],
  ["LCD", "FOR OPPO", "Oppo find x2 pro", "ORG", "BLACK", "￥68.10", "AUD 15.00", "", "1", "￥68.10", "AUD 15.00", "￥59.00"],
];
assert.equal(hasPiProductHeader(copiedDualCurrencyRows), true, "用户截图中的双币种表头须自动识别");
assert.equal(derivePiCnyRate(copiedDualCurrencyRows, "AUD"), 4.54, "反推汇率统一保留两位小数");
assert.equal(detectPiPaymentCurrency(copiedDualCurrencyRows), "AUD", "含空白分隔列时仍从双币种报价列识别外币");
const copiedDualImported = parsePiProductRows(copiedDualCurrencyRows, 1 / 4.54, "AUD");
assert.equal(copiedDualImported.length, 10, "双币种产品区域应完整导入全部10行");
assert.deepEqual(copiedDualImported.map(({ model, quantity, unit_price_cny, unit_price_payment, estimated_unit_cost_cny }) => [model, quantity, unit_price_cny, unit_price_payment, estimated_unit_cost_cny]), [
  ["S21", "1", "314.62", "69.30", "282.00"], ["S21 plus", "2", "314.62", "69.30", "282.00"],
  ["S21 ultra", "2", "355.03", "78.20", "318.00"], ["S22", "1", "505.76", "111.40", "453.00"],
  ["S22 ultra", "3", "355.03", "78.20", "318.00"], ["Note 20 ultra", "1", "309.17", "68.10", "277.00"],
  ["Xcover pro", "3", "111.23", "24.50", "100.00"], ["A04s", "2", "36.32", "8.00", "31.00"],
  ["Reno12 5G CPH 2625", "1", "108.96", "24.00", "97.00"], ["Oppo find x2 pro", "1", "68.10", "15.00", "59.00"],
], "样例中全部10行的数量、人民币/外币单价和成本都应映射准确");
assert.deepEqual([copiedDualImported[0].item_name, copiedDualImported[0].brand, copiedDualImported[0].model,
  copiedDualImported[0].quality, copiedDualImported[0].description, copiedDualImported[0].unit_price_cny,
  copiedDualImported[0].unit_price_payment, copiedDualImported[0].quantity, copiedDualImported[0].estimated_unit_cost_cny],
["LCD", "FOR SAM", "S21", "1:1 size Soft oled,WF", "BLACK", "314.62", "69.30", "1", "282.00"],
"复制表格中的每列必须映射到正确字段，空白分隔列不得导致数量错位");
const pastedDualTsv = copiedDualCurrencyRows.map((row) => row.join("\t")).join("\r\n");
assert.deepEqual(parsePiProductRows(pastedDualTsv.split(/\r?\n/).map((line) => line.split("\t")), 1 / 4.54, "AUD"), copiedDualImported,
  "真实剪贴板TSV双币种表格的识别结果须稳定一致");
const quotedHeaderTsv = copiedDualCurrencyRows.map((row) => row.map((value) => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join("\t")).join("\r\n");
const parsedQuotedHeader = parsePiClipboardTsv(quotedHeaderTsv);
assert.equal(parsedQuotedHeader.length, copiedDualCurrencyRows.length, "带换行的Excel表头单元格不能拆坏TSV行");
assert.deepEqual(parsePiProductRows(parsedQuotedHeader, 1 / 4.54, "AUD"), copiedDualImported, "带引号换行表头粘贴结果应与Excel导入一致");
const headerlessDualRows = copiedDualCurrencyRows.slice(1);
assert.equal(detectPiPaymentCurrency(headerlessDualRows), "AUD", "仅复制产品数据区且有空白分隔列时识别付款币种");
assert.equal(derivePiCnyRate(headerlessDualRows, "AUD"), 4.54, "无表头双币种数据区反推汇率保留两位小数");
const omitSourceRow = ({ source_row, ...item }) => { void source_row; return item; };
assert.deepEqual(parsePiProductRows(headerlessDualRows, 1 / 4.54, "AUD").map(omitSourceRow), copiedDualImported.map(omitSourceRow),
  "无表头产品数据区的空白分隔列不得导致数量错位或整批失败");
const noHeaderAmounts = [
  ["LCD", "FOR SAM", "S21", "OLED", "BLACK", "AUD 69.30", "¥314.62", "", "1", "¥282.00"],
];
assert.equal(derivePiCnyRate(noHeaderAmounts, "AUD"), 4.54, "无表头人民币/外币单价列顺序互换仍可反推汇率");
assert.deepEqual(parsePiProductRows(noHeaderAmounts, 1 / 4.54, "AUD").map(({ item_name, unit_price_cny, unit_price_payment, quantity, estimated_unit_cost_cny }) => ({ item_name, unit_price_cny, unit_price_payment, quantity, estimated_unit_cost_cny })),
  [{ item_name: "LCD", unit_price_cny: "314.62", unit_price_payment: "69.30", quantity: "1", estimated_unit_cost_cny: "282.00" }],
  "无金额小计列的双币种粘贴表格也应正确区分数量与成本");
assert.throws(() => parsePiProductRows(headerlessDualRows, 1 / 4.54, "USD"), /价格币种与PI付款币种 USD 不一致/,
  "双币种明细与已选外币不一致时应明确阻止导入");
const headerlessSingleCurrency = [
  ["LCD", "FOR SAM", "S21", "OLED", "BLACK", "AUD 100", "2", "¥282"],
];
assert.deepEqual(parsePiProductRows(headerlessSingleCurrency, 1 / 4.54, "AUD").map(({ item_name, unit_price_cny, unit_price_payment, quantity, estimated_unit_cost_cny }) => ({ item_name, unit_price_cny, unit_price_payment, quantity, estimated_unit_cost_cny })),
  [{ item_name: "LCD", unit_price_cny: "454.00", unit_price_payment: "100.00", quantity: "2", estimated_unit_cost_cny: "282.00" }],
  "无表头单外币粘贴行应跳过金额列并映射数量和人民币成本");
const headerlessCny = [["LCD", "FOR SAM", "S21", "OLED", "BLACK", "CNY 100", "2", "￥80"]];
assert.deepEqual(parsePiProductRows(headerlessCny, 1, "CNY").map(({ unit_price_cny, unit_price_payment, quantity, estimated_unit_cost_cny }) => ({ unit_price_cny, unit_price_payment, quantity, estimated_unit_cost_cny })),
  [{ unit_price_cny: "100.00", unit_price_payment: "100.00", quantity: "2", estimated_unit_cost_cny: "80.00" }],
  "无表头人民币报价粘贴行应正确导入");
for (const currency of QUOTE_CURRENCY_CODES) {
  const sourceRow = [["LCD", "FOR SAM", "S21", "OLED", "BLACK", `${currency} 100`, "2", "CNY 1"]];
  assert.equal(detectPiPaymentCurrency(sourceRow), currency, `${currency} 币种代码应可从粘贴价格识别`);
  assert.equal(parsePiProductRows(sourceRow, currency === "CNY" ? 1 : 0.15, currency)[0].unit_price_payment, "100.00",
    `${currency} 币种代码应可完成产品行解析`);
}
const formSource = readFileSync("components/pi-order-form.tsx", "utf8");
assert.match(formSource, /await prepareImportRows\(productSheet\.rows\)/, "Excel button must use the tested parser");
assert.match(formSource, /await importPastedText\(text\)/, "clipboard text must use the shared PI paste parser and currency inference flow");
assert.match(formSource, /navigator\.clipboard\?\.readText/, "clipboard API must be feature-detected");
assert.match(formSource, /setPasteFallbackOpen\(true\)/, "clipboard focus or permission failures must open the manual paste fallback");
assert.match(formSource, /role="dialog"|title="粘贴产品明细"/, "manual paste fallback must be presented in an accessible dialog");
assert.match(formSource, /按 Ctrl\+V/, "manual paste fallback must explain how to paste without exposing browser errors");
assert.match(formSource, /role="alert" className="mb-3 rounded-lg border border-rose-200/, "paste validation errors must be visible inside the fallback dialog");
assert.match(formSource, /无法识别表格内容，请检查产品明细列和金额格式后重试/, "parser errors must use a localized, actionable message");
assert.doesNotMatch(formSource, /catch \(cause\) \{ setError\(cause instanceof Error \? cause\.message : "读取剪贴板失败"\); \}/, "native clipboard exceptions must not leak raw English browser errors");
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
