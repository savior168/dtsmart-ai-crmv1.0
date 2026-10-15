import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { matchImportedPaymentAccount, parseCustomerPiWorkbook } from "../lib/pi-document-import.ts";

const template = readFileSync("assets/templates/PI_Import_Template.xlsx");
const archive = XLSX.CFB.read(template, { type: "buffer" });
const stylesXml = Buffer.from(XLSX.CFB.find(archive, "/xl/styles.xml").content).toString("utf8");
assert.match(stylesXml, /<x:color rgb="FFC62828"/, "必填标记必须使用红色字体");
const book = XLSX.read(template, { type: "buffer", cellStyles: true, cellFormula: true });
const sheet = book.Sheets[book.SheetNames[0]];
assert.equal(sheet.G2.v, "COMMERCIAL INVOICE");
assert.equal(sheet.A18.v, "No.");
assert.equal(sheet.I18.v, "Unit Price (USD)", "单价列标题应与正式PI导出一致并显示币种");
assert.equal(sheet.K18.v, "Amount (USD)", "金额列标题应与正式PI导出一致并显示币种");
assert.match(sheet.I18.f, /J6/, "模板单价标题应随顶部所选币种更新");
assert.match(sheet.K18.f, /J6/, "模板金额标题应随顶部所选币种更新");
assert.match(String(sheet.I2.v), /\*.*订单编号/);
assert.match(String(sheet.G6.v), /\*.*客户付款币种/);
for (const address of ["B17", "D17", "E17", "F17", "I17", "J17"]) {
  assert.equal(sheet[address].v, "*", `${address} 应标记必填`);
}
assert.match(String(sheet.A73.v), /人民币售价、成本、汇率及收款账户由系统核对时补全/);
assert.equal(sheet.J6.v, "USD");
assert.equal(sheet.J2?.v, undefined, "模板订单编号必须留空供销售填写");

const example = XLSX.read(template, { type: "buffer" });
const exampleSheet = example.Sheets[example.SheetNames[0]];
exampleSheet.J2 = { t: "s", v: "D60020733" };
for (const [column, value] of Object.entries({ B: "LCD", D: "IPH", E: "IP 17 Pro", F: "OLED", G: "COF", I: 41.64, J: 20 })) {
  exampleSheet[`${column}19`] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
}
exampleSheet.J8 = { t: "n", v: 46325 };
const parsed = parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" }));
assert.equal(parsed.document.warehouse_reference_number, "D60020733");
assert.equal(parsed.document.currency, "USD");
assert.equal(parsed.document.items.length, 1);
assert.equal(parsed.document.items[0].amount_payment, 832.8);
assert.equal(parsed.document.shipping_payment, 0);
assert.match(parsed.document.delivery_date, /^\d{4}-\d{2}-\d{2}$/, "Excel 数值日期应正确解析");
exampleSheet.J6.v = "T/T Bank Transfer (USD)";
const exportedPi = parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" }));
assert.equal(exportedPi.document.currency, "USD", "正式导出中的付款方式应从币种标注中识别币种");
assert.equal(exportedPi.document.payment_method, "T/T Bank Transfer", "正式导出付款方式应去除重复币种后缀并匹配系统渠道");
assert.equal(typeof exportedPi.payment_account_instructions, "string", "应识别正式PI内的付款账户信息以便服务端安全匹配");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "USD", instructions: " bank: a account: 123 " }], "USD"), "account-1", "账户明文仅经忽略空白后的精确匹配才应自动关联");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "USD", instructions: "BANK: A ACCOUNT: 123" }, { id: "account-2", currency: "USD", instructions: "BANK: A ACCOUNT: 123" }], "USD"), "", "多账户匹配时不得自动绑定");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "EUR", instructions: "BANK: A ACCOUNT: 123" }], "USD"), "", "币种不同不得自动绑定账户");
exampleSheet.J6.v = "EUR";
assert.equal(parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })).document.currency, "EUR", "导入币种以明确填写的币种字段为准，不受缓存表头影响");
exampleSheet.J6.v = "USD";
assert.throws(() => parseCustomerPiWorkbook(template), /订单编号不能为空/, "未填写必填项不得生成草稿");
exampleSheet.J19 = { t: "n", v: 1.5 };
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /整数数量/);

const route = readFileSync("app/api/orders/import-template/route.ts", "utf8");
const view = readFileSync("components/pi-import-view.tsx", "utf8");
const conversion = readFileSync("app/api/orders/import-drafts/[id]/convert/route.ts", "utf8");
assert.match(route, /requirePermission\("orders\.import"\)/);
assert.match(route, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
assert.match(route, /filename\*=UTF-8''PI-import-template\.xlsx/);
assert.match(view, /下载PI导入模板/);
assert.match(view, /accept="\.xlsx"/);
assert.match(conversion, /acknowledge_differences/);
const form = readFileSync("components/pi-order-form.tsx", "utf8");
assert.match(form, /"保存PI草稿"[\s\S]*"确认并生成备货单"/, "导入核对页与新建页应提供保存草稿、确认生成备货单两个入口");
assert.doesNotMatch(form, /if \(importDraftId && submitToWarehouse\)/, "导入PI核对页应允许直接确认提交仓库");
assert.match(form, /unit_price_payment \* importedRate/, "导入客户外币单价应按当前业务汇率折算并预填人民币售价");
assert.match(form, /source\.shipping_payment \* importedRate/, "导入外币运费应按当前业务汇率折算并预填人民币运费");
assert.match(form, /exactCustomerMatches\.length === 1/, "仅在本人客户名称唯一精确匹配时自动关联客户");
assert.match(form, /submitAfterImportDifferences \? "将保存PI并生成备货单"/, "差异核对确认应保留直接提交仓库意图");
assert.match(readFileSync("app/api/orders/import-drafts/route.ts", "utf8"), /matchImportedPaymentAccount[\s\S]*payment_account_id/,
  "付款账户只能服务端唯一精确匹配，并只在导入草稿中保存账户ID而不保留账户明文");
console.log("PI整单导入模板、必填标记、解析校验及待补全流程回归通过。");

