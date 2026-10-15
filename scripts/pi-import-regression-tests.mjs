import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { parseCustomerPiWorkbook } from "../lib/pi-document-import.ts";

const template = readFileSync("assets/templates/PI_Import_Template.xlsx");
const archive = XLSX.CFB.read(template, { type: "buffer" });
const stylesXml = Buffer.from(XLSX.CFB.find(archive, "/xl/styles.xml").content).toString("utf8");
assert.match(stylesXml, /<x:color rgb="FFC62828"/, "必填标记必须使用红色字体");
const book = XLSX.read(template, { type: "buffer", cellStyles: true, cellFormula: true });
const sheet = book.Sheets[book.SheetNames[0]];
assert.equal(sheet.G2.v, "COMMERCIAL INVOICE");
assert.equal(sheet.A18.v, "No.");
assert.match(String(sheet.I2.v), /\*.*订单编号/);
assert.match(String(sheet.G6.v), /\*.*客户付款币种/);
for (const address of ["B17", "D17", "E17", "F17", "I17", "J17"]) {
  assert.equal(sheet[address].v, "*", `${address} 应标记必填`);
}
assert.match(String(sheet.A73.v), /人民币售价、成本、汇率及收款账户在系统核对时补全/);
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
assert.throws(() => parseCustomerPiWorkbook(template), /订单编号不能为空/, "未填写必填项不得生成草稿");
exampleSheet.J19 = { t: "n", v: 1.5 };
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /整数数量/);

const route = readFileSync("app/api/orders/import-template/route.ts", "utf8");
const view = readFileSync("components/pi-import-view.tsx", "utf8");
const conversion = readFileSync("app/api/orders/import-drafts/[id]/convert/route.ts", "utf8");
assert.match(route, /requirePermission\("orders\.import"\)/);
assert.match(view, /下载PI导入模板/);
assert.match(conversion, /acknowledge_differences/);
assert.match(readFileSync("components/pi-order-form.tsx", "utf8"), /importDraftId[\s\S]*补全并生成PI草稿/);
console.log("PI整单导入模板、必填标记、解析校验及待补全流程回归通过。");
