import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { matchImportedPaymentAccount, parseCustomerPiWorkbook } from "../lib/pi-document-import.ts";
import { parsePiProductRows } from "../lib/pi-product-import.ts";
import { buildDirectPiWorkbook } from "../lib/direct-pi-export.ts";

const template = readFileSync("assets/templates/PI_Import_Template.xlsx");
const archive = XLSX.CFB.read(template, { type: "buffer" });
const stylesXml = Buffer.from(XLSX.CFB.find(archive, "/xl/styles.xml").content).toString("utf8");
assert.match(stylesXml, /<x:color rgb="FFC62828"/, "必填标记必须使用红色字体");
const book = XLSX.read(template, { type: "buffer", cellStyles: true, cellFormula: true });
const sheet = book.Sheets[book.SheetNames[0]];
assert.equal(sheet.G2.v, "COMMERCIAL INVOICE");
assert.equal(sheet.A18.v, "No.");
assert.equal(sheet.I18.v, "Unit Price (CNY) *", "PI导入模板人民币单价列必须与导出PI一致");
assert.equal(sheet.K18.v, "Quantity *");
for (const [address, expected] of Object.entries({ B18: "Items *", D18: "Brand *", E18: "Models *", F18: "Quality *", I18: "Unit Price (CNY) *", K18: "Quantity *" })) {
  assert.equal(sheet[address].v, expected, `${address} 必填星号须紧贴产品表头`);
}
assert.equal(sheet.L18.v, "Amount (CNY)");
assert.match(sheet.J18.f, /J6/, "模板付款币种单价标题应随顶部所选币种更新");
assert.match(sheet.M18.f, /J6/, "模板付款币种金额标题应随顶部所选币种更新");
assert.match(sheet.J19.f, /ROUND\(I19\/\$J\$7,2\)/, "付款币种单价应由人民币单价与必填汇率自动计算");
assert.match(sheet.L19.f, /ROUND\(I19\*K19,2\)/, "人民币金额应由人民币单价和数量计算");
assert.match(sheet.M19.f, /ROUND\(J19\*K19,2\)/, "外币金额应由外币单价和数量计算");
assert.match(String(sheet.I2.v), /\*.*订单编号/);
assert.match(String(sheet.G6.v), /\*.*客户付款币种/);
for (const address of ["B17", "D17", "E17", "F17", "I17", "K17"]) {
  assert.equal(sheet[address]?.v, undefined, `${address} 不应再孤立显示必填星号`);
}
assert.match(String(sheet.A76.v), /PAYMENT INFORMATION/);
assert.match(String(sheet.A78.v), /红色 \* 为必填/);
assert.equal(sheet.J6?.v || "", "", "新模板不得预填币种，须由用户选择");
assert.match(Buffer.from(XLSX.CFB.find(archive, "/xl/worksheets/sheet1.xml").content).toString("utf8"), /dataValidation[^>]*sqref="J6"/, "付款币种应提供下拉选择");
assert.equal(sheet.J2?.v, undefined, "模板订单编号必须留空供销售填写");

const example = XLSX.read(template, { type: "buffer", cellFormula: true });
const exampleSheet = example.Sheets[example.SheetNames[0]];
exampleSheet.J2 = { t: "s", v: "D60020733" };
exampleSheet.J4 = { t: "n", v: 46325 };
exampleSheet.J6 = { t: "s", v: "USD" };
exampleSheet.J7 = { t: "n", v: 6.668 };
exampleSheet.J8 = { t: "s", v: "PayPal" };
exampleSheet.J9 = { t: "n", v: 46327 };
exampleSheet.D13 = { t: "s", v: "Example Buyer Co." };
exampleSheet.D14 = { t: "s", v: "VAT123" };
exampleSheet.D15 = { t: "s", v: "Example Buyer · TEL: +12345" };
exampleSheet.D16 = { t: "s", v: "buyer@example.com" };
exampleSheet.G14 = { t: "s", v: "1 Example Street" };
for (const [column, value] of Object.entries({ B: "LCD", D: "IPH", E: "IP 17 Pro", F: "OLED", G: "COF", I: 285, K: 10 })) {
  exampleSheet[`${column}19`] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
}
exampleSheet.J19 = { t: "n", f: "ROUND(I19/J7,2)", v: 42.74 };
exampleSheet.L19 = { t: "n", f: "ROUND(I19*K19,2)", v: 2850 };
exampleSheet.M19 = { t: "n", f: "ROUND(J19*K19,2)", v: 427.4 };
const parsed = parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" }));
assert.equal(parsed.document.warehouse_reference_number, "D60020733");
assert.equal(parsed.document.currency, "USD");
assert.equal(parsed.document.items.length, 1);
assert.equal(parsed.document.items[0].unit_price_cny, 285);
assert.equal(parsed.document.items[0].unit_price_payment, 42.74);
assert.equal(parsed.document.items[0].amount_payment, 427.4);
assert.equal(parsed.document.fx_rate_cny_per_payment, 6.668);
assert.equal(parsed.document.customer_tax_number, "VAT123");
assert.equal(parsed.document.delivery_address, "1 Example Street");
assert.equal(parsed.document.payment_method, "PayPal");
assert.equal(parsed.document.valid_until, "2026-10-30");
assert.equal(parsed.document.shipping_payment, 0);
assert.equal(parsed.document.delivery_date, "2026-11-01", "Excel 数值日期应正确解析");
const savedCurrency = exampleSheet.J6;
const savedRate = exampleSheet.J7;
const savedValidity = exampleSheet.J4;
const savedRecipient = exampleSheet.D15;
delete exampleSheet.J7;
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /汇率为必填/, "缺少汇率必须拒绝整单导入");
exampleSheet.J7 = savedRate;
exampleSheet.J4 = { t: "s", v: "not a date" };
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /PI有效期/, "PI有效期必须是有效日期");
exampleSheet.J4 = savedValidity;
exampleSheet.D15 = { t: "s", v: "Example Buyer" };
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /收货人（客户）和联系电话/, "收件人和电话缺一不可");
exampleSheet.D15 = savedRecipient;
exampleSheet.J6 = savedCurrency;
const invoiceSubtotalRow = Array.from({ length: 500 }, (_, index) => index + 19).find((row) => /SUBTOTAL/i.test(String(exampleSheet[`G${row}`]?.v || "")));
assert.ok(invoiceSubtotalRow);
exampleSheet["!ref"] = `A1:M${invoiceSubtotalRow + 9}`;
for (let row = invoiceSubtotalRow + 1; row <= invoiceSubtotalRow + 12; row += 1) delete exampleSheet[`A${row}`];
exampleSheet.A13 = { t: "s", v: "To: Example Buyer · TEL: +12345" };
for (const [offset, label, amount] of [
  [1, "SHIPPING COST:", 10], [2, "UNPAID BALANCE:", 20], [3, "OTHER CHARGES:", 3],
  [4, "DISCOUNT:", -2], [5, "PAYPAL FEE (5%):", 22.92], [6, "TOTAL AMOUNT:", 481.32],
]) {
  const row = invoiceSubtotalRow + offset;
  exampleSheet[`G${row}`] = { t: "s", v: label };
  exampleSheet[`M${row}`] = { t: "n", v: amount };
}
const feeImport = parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" }));
assert.equal(feeImport.document.customer_name, "Example Buyer");
assert.equal(feeImport.document.total_payment, 481.32, "导出的所有费用行须回算到同一总金额");
assert.equal(feeImport.document.paypal_rate_percent, 5);
assert.equal(feeImport.document.last_balance_payment, 20);
assert.equal(feeImport.document.shipping_cny, 66.68, "费用人民币金额应按模板汇率换算");
exampleSheet["!ref"] = `A1:M${invoiceSubtotalRow + 8}`;
exampleSheet[`A${invoiceSubtotalRow + 7}`] = { t: "s", v: "PAYMENT INFORMATION" };
exampleSheet[`A${invoiceSubtotalRow + 8}`] = { t: "s", v: "BANK: A ACCOUNT: 123" };
assert.equal(parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })).payment_account_instructions, "BANK: A ACCOUNT: 123", "客户版式模板须可填写和解析完整收款账户信息");
const totalAddress = `M${invoiceSubtotalRow + 6}`;
delete exampleSheet[totalAddress].f;
exampleSheet[totalAddress].v = 481.31;
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /订单总金额/, "非公式总金额不一致不得静默导入");
exampleSheet[totalAddress].v = 481.32;
exampleSheet.J6.v = "T/T Bank Transfer (USD)";
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /客户付款币种/, "客户模板不能把付款方式错填到币种列");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "USD", instructions: " bank: a account: 123 " }], "USD"), "account-1", "账户明文仅经忽略空白后的精确匹配才应自动关联");
assert.equal(matchImportedPaymentAccount("BANK: A ACCOUNT: 123", [{ id: "account-1", currency: "USD", payment_channel: "PayPal", instructions: "BANK: A ACCOUNT: 123" }], "USD", "T/T Bank Transfer"), "", "付款渠道不匹配时不得自动关联账户");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "USD", instructions: "BANK: A ACCOUNT: 123" }, { id: "account-2", currency: "USD", instructions: "BANK: A ACCOUNT: 123" }], "USD"), "", "多账户匹配时不得自动绑定");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "EUR", instructions: "BANK: A ACCOUNT: 123" }], "USD"), "", "币种不同不得自动绑定账户");
const exportFixture = {
  order_number: "PI-ROUNDTRIP-001", created_at: "2026-10-23T09:00:00.000Z", confirmed_at: "2026-10-23T09:00:00.000Z",
  pi_valid_until: "2026-10-28", seller_company_name: "DT-Smart Technology Co., Ltd", seller_company_address: "Shenzhen",
  seller_website: "https://www.dt-smart.com/", seller_contact_name: "Jamie", seller_contact_phone: "+86 123456789",
  seller_contact_email: "jamie@example.com", customer_short_name: "Roundtrip Buyer Co.",
  customer: { company_name: "Roundtrip Buyer Co.", contact_name: "Alex Buyer", tax_number: "VAT123" },
  delivery_recipient: "Alex Buyer", delivery_phone: "+1 555 0100", delivery_email: "alex@example.com", delivery_address: "1 Test Street",
  delivery_date: "2026-10-30", currency: "USD", fx_rate_cny_to_payment: 0.15,
  payment_method: "T/T Bank Transfer", payment_account_snapshot: "BANK: Example\nACCOUNT: 123",
  subtotal_cny: 240, shipping_cny: 10, total_cny: 250, last_balance_cny: 0, discount_cny: 0, other_charge_cny: 0,
  paypal_fee_percent: 0, paypal_fee_cny: 0, subtotal: 36, shipping_cost: 1.5, total_amount: 37.5,
  last_balance_amount: 0, discount_amount: 0, other_charge_amount: 0, paypal_fee_amount: 0,
};
const exportedWorkbook = buildDirectPiWorkbook(exportFixture, [
  { line_number: 1, item_name: "LCD", brand: "IPH", model: "IP17", quality: "OLED", description: "120Hz", quantity: 2, unit_price_cny: 120, unit_price: 18 },
]);
const roundtrip = parseCustomerPiWorkbook(exportedWorkbook).document;
assert.equal(roundtrip.warehouse_reference_number, "PI-ROUNDTRIP-001", "实际系统导出的PI编号须正确回读");
assert.equal(roundtrip.currency, "USD", "实际系统导出的PI付款币种须正确回读");
assert.equal(roundtrip.customer_name, "Alex Buyer", "实际系统导出的PI客户联系人须正确回读");
assert.equal(roundtrip.delivery_company, "Roundtrip Buyer Co.", "实际系统导出的PI公司名称须正确回读");
assert.equal(roundtrip.items[0].unit_price_payment, 18, "实际系统导出的外币单价须正确回读");
assert.equal(roundtrip.items[0].amount_payment, 36, "实际系统导出的产品金额须从单价和数量正确回算");
assert.equal(roundtrip.subtotal_payment, 36, "实际系统导出的产品小计须正确回读");
assert.equal(roundtrip.shipping_payment, 1.5, "实际系统导出的运费须正确回读");
assert.equal(roundtrip.total_payment, 37.5, "实际系统导出的订单总金额须正确回读");
assert.equal(roundtrip.payment_method, "T/T Bank Transfer", "实际系统导出的付款渠道须正确回读");
const dualExportFixture = { ...exportFixture, show_dual_currency_prices: true };
const dualRoundtrip = parseCustomerPiWorkbook(buildDirectPiWorkbook(dualExportFixture, [
  { line_number: 1, item_name: "LCD", brand: "IPH", model: "IP17", quality: "OLED", description: "120Hz", quantity: 2, unit_price_cny: 120, unit_price: 18 },
])).document;
assert.equal(dualRoundtrip.items[0].unit_price_cny, 120, "双币种导出的CNY售价须明确回读，不仅回读外币售价");
assert.equal(dualRoundtrip.items[0].unit_price_payment, 18, "双币种导出的外币售价须与人民币售价分别回读");
exampleSheet.J6.v = "EUR";
assert.equal(parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })).document.currency, "EUR", "导入币种以明确填写的币种字段为准，不受缓存表头影响");
exampleSheet.J6.v = "USD";
delete exampleSheet.J6;
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /客户付款币种为必填项/, "不得从缓存的美元列头推断未填写的币种");
exampleSheet.J6 = { t: "s", v: "USD" };
assert.throws(() => parseCustomerPiWorkbook(template), /订单编号不能为空/, "未填写必填项不得生成草稿");
exampleSheet.K19 = { t: "n", v: 1.5 };
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /整数数量/);

const wholeTemplate = XLSX.readFile("assets/templates/PI_Whole_Order_Import_Template.xlsx", { cellFormula: true });
assert.deepEqual(wholeTemplate.SheetNames, ["PI基本信息", "PI产品明细", "填写示例"]);
const wholeExample = wholeTemplate.Sheets["填写示例"];
assert.match(String(wholeExample.A1.v), /不会导入/);
assert.equal(wholeExample.B6.v, "PI-EXAMPLE-001");
assert.equal(wholeExample.A30.v, "手机屏幕");
const basic = wholeTemplate.Sheets["PI基本信息"];
const lines = wholeTemplate.Sheets["PI产品明细"];
assert.equal(lines.E1.v, "产品描述", "产品描述应选填");
assert.equal(lines.I1, undefined, "PI整单模板明细去掉中文后端描述、理货要求及销售备注及计算列");
for (const [address, value] of Object.entries({ B3: "Jack Liu", B4: "i-Service", B5: "D6052456", B6: "USD", B7: 6.67, B8: "2026-11-01", B10: "T/T Bank Transfer", B11: "Jack Liu", B12: "+86 1520256556", B13: "jack@example.com", B14: "Dublin", B15: 100, B16: 50, B17: 5, B18: 8, B19: 0, B20: "是" })) {
  basic[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
}
for (const [address, value] of Object.entries({ A2: "LCD", B2: "IPH", C2: "IP17", D2: "OLED", F2: 80, G2: 120, H2: 10 })) {
  lines[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
}
const wholeBytes = () => XLSX.write(wholeTemplate, { type: "buffer", bookType: "xlsx" });
const whole = parseCustomerPiWorkbook(wholeBytes()).document;
assert.equal(whole.source_kind, "SYSTEM_TEMPLATE");
assert.equal(whole.customer_name, "Jack Liu");
assert.equal(whole.items[0].unit_price_cny, 120);
assert.equal(whole.items[0].estimated_unit_cost_cny, 80);
assert.equal(whole.items[0].description, "");
assert.equal(whole.items[0].description_zh, "");
assert.equal(whole.shipping_cny, 100);
assert.equal(whole.show_dual_currency_prices, true);
assert.equal(whole.last_balance_cny, 50);
const legacyWhole = XLSX.readFile("assets/templates/PI_Whole_Order_Import_Template.xlsx");
const legacyBasic = legacyWhole.Sheets["PI基本信息"];
const legacyLines = legacyWhole.Sheets["PI产品明细"];
for (const [address, value] of Object.entries({ B3: "Legacy Buyer", B5: "PI-OLD-001", B6: "USD" })) legacyBasic[address] = { t: "s", v: value };
for (const [address, value] of Object.entries({ A2: "LCD", B2: "IPH", C2: "IP17", D2: "OLED", G2: 80, H2: 120, J2: 10, O2: "旧版销售备注" })) legacyLines[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
legacyLines.I1 = { t: "s", v: "销售单价（付款币种，自动换算）" };
legacyLines["!ref"] = "A1:O501";
assert.equal(parseCustomerPiWorkbook(XLSX.write(legacyWhole, { type: "buffer", bookType: "xlsx" })).document.items[0].internal_note, "旧版销售备注", "旧整单模板须继续兼容");
assert.equal(basic.A22.v, "所属销售员登录邮箱（选填）");
assert.equal(basic.A23.v, "收款账户信息（选填）");
basic.B23 = { t: "s", v: "BANK: A ACCOUNT: 123" };
assert.equal(parseCustomerPiWorkbook(wholeBytes()).payment_account_instructions, "BANK: A ACCOUNT: 123");
delete basic.B23;
basic.B22 = { t: "s", v: "seller@example.com" };
assert.equal(parseCustomerPiWorkbook(wholeBytes()).document.sales_account_email, "seller@example.com");
basic.B22 = { t: "s", v: "销售员姓名" };
assert.throws(() => parseCustomerPiWorkbook(wholeBytes()), /登录邮箱/);
delete basic.B22;
basic.B13 = { t: "s", v: "not-an-email" };
assert.throws(() => parseCustomerPiWorkbook(wholeBytes()), /邮箱格式/);
basic.B13 = { t: "s", v: "jack@example.com" };
lines.F2 = { t: "n", v: 130 };
assert.throws(() => parseCustomerPiWorkbook(wholeBytes()), /售价必须高于成本/);
lines.F2 = { t: "n", v: 80 };

const wholeHelp = XLSX.utils.sheet_to_json(wholeTemplate.Sheets["PI基本信息"], { header: 1, defval: "" });
assert.match(String(wholeHelp[0][1]), /红色 \* 为必填/);
assert.equal(basic.A4.v, "公司名称（选填）", "公司名称应与创建PI页面一致，不强制填写");
assert.match(String(basic.C4.v), /可留空.*导入后手动选择客户/);
assert.match(String(wholeHelp[10][2]), /启用客户收货信息时必填/);
assert.match(String(wholeHelp[12][0]), /邮箱（选填）/);
assert.match(String(wholeHelp[22][2]), /同币种启用账户中唯一精确匹配.*否则导入后手动选择/);
assert.equal(wholeTemplate.Sheets["PI产品明细"].I1, undefined, "PI整单模板不得再包含三个导入后补充字段");

const optionalWhole = XLSX.readFile("assets/templates/PI_Whole_Order_Import_Template.xlsx", { cellFormula: true });
const optionalBasic = optionalWhole.Sheets["PI基本信息"];
const optionalLines = optionalWhole.Sheets["PI产品明细"];
for (const [address, value] of Object.entries({ B3: "Jack Liu", B5: "D6052457", B6: "USD" })) optionalBasic[address] = { t: "s", v: value };
for (const [address, value] of Object.entries({ A2: "LCD", B2: "IPH", C2: "IP17", D2: "OLED", F2: 80, G2: 120, H2: 10 })) optionalLines[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
const optionalDocument = parseCustomerPiWorkbook(XLSX.write(optionalWhole, { type: "buffer", bookType: "xlsx" })).document;
assert.equal(optionalDocument.delivery_company, "", "PI整单模板公司名称选填");
assert.equal(optionalDocument.delivery_recipient, "", "未启用客户收货信息时收件人可以留空");
assert.equal(optionalDocument.delivery_phone, "", "未启用客户收货信息时电话可以留空");
assert.equal(optionalDocument.delivery_email, "", "收货邮箱选填");
assert.equal(optionalDocument.delivery_address, "", "未启用客户收货信息时地址可以留空");
assert.equal(optionalDocument.payment_method, "", "付款渠道可留空，导入核对页由用户选择");
assert.equal(optionalDocument.fx_rate_cny_per_payment, 0, "汇率可留空并在导入核对页采用当前业务汇率");
assert.equal(optionalDocument.items.length, 1, "PI整单模板至少须提供一条产品明细");

const productTemplate = XLSX.readFile("public/templates/pi-line-import-template.xlsx", { cellFormula: true });
const productSheet = productTemplate.Sheets["PI产品明细"];
assert.deepEqual(
  XLSX.utils.sheet_to_json(lines, { header: 1, range: "A1:H1" })[0],
  XLSX.utils.sheet_to_json(productSheet, { header: 1, range: "A1:H1" })[0],
  "整单模板与产品明细导入模板须逐列完全一致",
);
assert.deepEqual(XLSX.utils.sheet_to_json(productSheet, { header: 1, range: "A1:H1" })[0], ["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "成本单价（CNY） *", "销售单价（CNY） *", "数量 *"]);
assert.equal(productSheet.I1, undefined, "两个模板均不得包含中文后端描述、理货要求及销售备注");
assert.equal(productSheet.I1, undefined, "新模板不应保留自动计算金额、利润等导入列");
for (const [address, value] of Object.entries({ A2: "LCD", B2: "IPH", C2: "IP 17 Pro", D2: "OLED", E2: "产品描述", F2: 80, G2: 120, H2: 10 })) {
  productSheet[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
}
const excelRows = XLSX.utils.sheet_to_json(productSheet, { header: 1, defval: "" });
const excelImported = parsePiProductRows(excelRows, 0.15);
const pastedImported = parsePiProductRows(excelRows.map((row) => row.map((cell) => String(cell ?? ""))), 0.15);
assert.deepEqual(pastedImported, excelImported, "Excel导入与粘贴表格须使用相同字段映射和校验");
assert.equal(excelImported.length, 1);
assert.equal(excelImported[0].item_name, "LCD");
assert.equal(excelImported[0].unit_price_payment, "18.00");
assert.equal(excelImported[0].preparation_requirement, "", "导入后由用户补全理货要求");
assert.equal(excelImported[0].internal_note, "", "导入后由用户补全销售备注");
assert.equal(excelImported[0].description_zh, "", "导入后由用户补全后端中文描述");
assert.deepEqual(parsePiProductRows([excelRows[1]], 0.15), excelImported, "无表头复制的数据区域仍按标准列序解析");
const legacyProductImport = parsePiProductRows([["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "产品质量/描述中文（展示给后端）", "成本单价（CNY） *", "销售单价（CNY） *", "数量 *", "销售金额（CNY）", "总利润（CNY）", "利润率", "理货要求", "销售备注"], ["LCD", "IPH", "IP17", "OLED", "legacy desc", "仓库中文", 80, 120, 2, 240, 80, "33.33%", "旧理货", "旧备注"]], 0.15);
assert.equal(legacyProductImport[0].preparation_requirement, "旧理货", "旧版14列含公式模板仍应正确读取理货要求");
assert.equal(legacyProductImport[0].internal_note, "旧备注", "旧版14列含公式模板仍应正确读取销售备注");
assert.throws(() => parsePiProductRows([excelRows[2]], 0.15), /1至500条产品明细/, "模板空白公式行不得误判为明细");
assert.throws(() => parsePiProductRows([["LCD", "IPH", "IP17", "OLED", "", "", "", ""]], 0.15), /须填写产品、品牌、型号、质量、整数数量/, "缺少产品必填价格或数量须拒绝");
const formSource = readFileSync("components/pi-order-form.tsx", "utf8");
assert.match(formSource, /parsePiProductRows\(rows, effectiveRate\)/, "PI导入入口须调用共享解析器");
assert.match(formSource, /importRows\(XLSX\.utils\.sheet_to_json/, "Excel上传须进入共享导入处理");
assert.match(formSource, /importRows\(\(await navigator\.clipboard\.readText\(\)\)\.split\(/, "剪贴板粘贴须进入同一共享处理");

const route = readFileSync("app/api/orders/import-template/route.ts", "utf8");
const view = readFileSync("components/pi-import-view.tsx", "utf8");
const conversion = readFileSync("app/api/orders/import-drafts/[id]/convert/route.ts", "utf8");
assert.match(route, /requirePermission\("orders\.import"\)/);
assert.match(readFileSync("app/api/orders/import-drafts/route.ts", "utf8"), /sales_account_email\.toLowerCase\(\) !== account\.email\.toLowerCase\(\)/);
assert.match(readFileSync("app/api/orders/import-drafts/route.ts", "utf8"), /\.ilike\("email", salesEmailPattern\)[\s\S]*owner\.email\.toLowerCase\(\) !== parsed\.document\.sales_account_email\.toLowerCase\(\)/,
  "跟单员导入的销售员邮箱应忽略大小写，并在查询后核对精确账号");
assert.match(route, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
assert.match(route, /PI-invoice-layout-template/);
assert.match(route, /PI_Whole_Order_Import_Template\.xlsx/, "下载接口须提供当前系统整单模板");
assert.match(view, /下载PI导入模板/);
assert.match(view, /\/api\/orders\/import-template\?format=invoice/, "页面应只提供客户版式导入模板");
assert.doesNotMatch(view, /下载系统整单模板|下载客户版式模板/, "页面不应让用户在两种模板间选择");
assert.match(view, /title="删除导入草稿" aria-label=\{`删除导入草稿/, "删除操作应为有文字提示和无障碍名称的图标按钮");
assert.match(view, /accept="\.xlsx"/);
assert.match(conversion, /acknowledge_differences/);
const form = readFileSync("components/pi-order-form.tsx", "utf8");
assert.match(form, /"保存PI草稿"[\s\S]*"确认并生成备货单"/, "导入核对页与新建页应提供保存草稿、确认生成备货单两个入口");
assert.doesNotMatch(form, /if \(importDraftId && submitToWarehouse\)/, "导入PI核对页应允许直接确认提交仓库");
assert.match(form, /unit_price_payment \* importedRate/, "导入客户外币单价应按当前业务汇率折算并预填人民币售价");
assert.match(form, /source\.fx_rate_cny_per_payment \|\| systemRate/, "模板明确汇率优先用于全部换算；无模板汇率的正式导出PI才回退系统业务汇率");
assert.match(form, /item\.unit_price_cny !== undefined \? importedRate > 0 \?[^\n]+: ""/, "缺失汇率时人民币来源商品的外币售价必须留空，不能显示错误换算值");
assert.match(form, /setShippingFee\(\{ enabled: true, source: "PAYMENT", amount: source\.shipping_payment\.toFixed\(2\) \}\)/, "导入外币运费应保留外币原值供销售核对，并按当前业务汇率换算人民币显示");
assert.match(form, /exactCustomerMatches\.length === 1/, "仅在本人公司名称唯一精确匹配时自动关联客户");
assert.match(form, /submitAfterImportDifferences \? "将保存PI并生成备货单"/, "差异核对确认应保留直接提交仓库意图");
assert.match(readFileSync("app/api/orders/import-drafts/route.ts", "utf8"), /matchImportedPaymentAccount[\s\S]*payment_account_id/,
  "付款账户只能服务端唯一精确匹配，并只在导入草稿中保存账户ID而不保留账户明文");
console.log("PI整单导入模板、必填标记、解析校验及待补全流程回归通过。");
