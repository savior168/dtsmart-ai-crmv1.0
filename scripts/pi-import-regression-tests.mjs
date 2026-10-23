import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { matchImportedPaymentAccount, parseCustomerPiWorkbook } from "../lib/pi-document-import.ts";
import { parsePiProductRows } from "../lib/pi-product-import.ts";

const template = readFileSync("assets/templates/PI_Import_Template.xlsx");
const archive = XLSX.CFB.read(template, { type: "buffer" });
const stylesXml = Buffer.from(XLSX.CFB.find(archive, "/xl/styles.xml").content).toString("utf8");
assert.match(stylesXml, /<x:color rgb="FFC62828"/, "必填标记必须使用红色字体");
const book = XLSX.read(template, { type: "buffer", cellStyles: true, cellFormula: true });
const sheet = book.Sheets[book.SheetNames[0]];
assert.equal(sheet.G2.v, "COMMERCIAL INVOICE");
assert.equal(sheet.A18.v, "No.");
assert.equal(sheet.I18.v, "Unit Price (select currency)", "未选币种时单价列不得误显示 USD");
assert.equal(sheet.K18.v, "Amount (select currency)", "未选币种时金额列不得误显示 USD");
assert.match(sheet.I18.f, /J6/, "模板单价标题应随顶部所选币种更新");
assert.match(sheet.K18.f, /J6/, "模板金额标题应随顶部所选币种更新");
assert.match(String(sheet.I2.v), /\*.*订单编号/);
assert.match(String(sheet.G6.v), /\*.*客户付款币种/);
for (const address of ["B17", "D17", "E17", "F17", "I17", "J17"]) {
  assert.equal(sheet[address].v, "*", `${address} 应标记必填`);
}
assert.match(String(sheet.A72.v), /PAYMENT INFORMATION/);
assert.match(String(sheet.A74.v), /人民币售价、成本、汇率及收款账户由系统核对时补全/);
assert.equal(sheet.J6?.v || "", "", "新模板不得预填币种，须由用户选择");
assert.match(Buffer.from(XLSX.CFB.find(archive, "/xl/worksheets/sheet1.xml").content).toString("utf8"), /dataValidation[^>]*sqref="J6"/, "付款币种应提供下拉选择");
assert.equal(sheet.J2?.v, undefined, "模板订单编号必须留空供销售填写");

const example = XLSX.read(template, { type: "buffer" });
const exampleSheet = example.Sheets[example.SheetNames[0]];
exampleSheet.J2 = { t: "s", v: "D60020733" };
exampleSheet.J6 = { t: "s", v: "USD" };
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
const invoiceSubtotalRow = Array.from({ length: 500 }, (_, index) => index + 19).find((row) => /SUBTOTAL/i.test(String(exampleSheet[`G${row}`]?.v || "")));
assert.ok(invoiceSubtotalRow);
exampleSheet["!ref"] = `A1:K${invoiceSubtotalRow + 6}`;
for (let row = invoiceSubtotalRow + 1; row <= invoiceSubtotalRow + 12; row += 1) delete exampleSheet[`A${row}`];
exampleSheet.A13 = { t: "s", v: "To: Example Buyer · TEL: +12345" };
for (const [offset, label, amount] of [
  [1, "SHIPPING COST:", 10], [2, "UNPAID BALANCE:", 20], [3, "OTHER CHARGES:", 3],
  [4, "DISCOUNT:", -2], [5, "PAYPAL FEE (5%):", 5], [6, "TOTAL AMOUNT:", 868.8],
]) {
  const row = invoiceSubtotalRow + offset;
  exampleSheet[`G${row}`] = { t: "s", v: label };
  exampleSheet[`K${row}`] = { t: "n", v: amount };
}
const feeImport = parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" }));
assert.equal(feeImport.document.customer_name, "Example Buyer");
assert.equal(feeImport.document.total_payment, 868.8, "导出的所有费用行须回算到同一总金额");
assert.equal(feeImport.document.paypal_rate_percent, 5);
assert.equal(feeImport.document.last_balance_payment, 20);
exampleSheet["!ref"] = `A1:K${invoiceSubtotalRow + 8}`;
exampleSheet[`A${invoiceSubtotalRow + 7}`] = { t: "s", v: "PAYMENT INFORMATION" };
exampleSheet[`A${invoiceSubtotalRow + 8}`] = { t: "s", v: "BANK: A ACCOUNT: 123" };
assert.equal(parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })).payment_account_instructions, "BANK: A ACCOUNT: 123", "客户版式模板须可填写和解析完整收款账户信息");
exampleSheet[`K${invoiceSubtotalRow + 6}`].v = 868.7;
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /订单总金额/, "非公式总金额不一致不得静默导入");
exampleSheet[`K${invoiceSubtotalRow + 6}`].v = 868.8;
exampleSheet.J6.v = "T/T Bank Transfer (USD)";
const exportedPi = parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" }));
assert.equal(exportedPi.document.currency, "USD", "正式导出中的付款方式应从币种标注中识别币种");
assert.equal(exportedPi.document.payment_method, "T/T Bank Transfer", "正式导出付款方式应去除重复币种后缀并匹配系统渠道");
assert.equal(typeof exportedPi.payment_account_instructions, "string", "应识别正式PI内的付款账户信息以便服务端安全匹配");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "USD", instructions: " bank: a account: 123 " }], "USD"), "account-1", "账户明文仅经忽略空白后的精确匹配才应自动关联");
assert.equal(matchImportedPaymentAccount("BANK: A ACCOUNT: 123", [{ id: "account-1", currency: "USD", payment_channel: "PayPal", instructions: "BANK: A ACCOUNT: 123" }], "USD", "T/T Bank Transfer"), "", "付款渠道不匹配时不得自动关联账户");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "USD", instructions: "BANK: A ACCOUNT: 123" }, { id: "account-2", currency: "USD", instructions: "BANK: A ACCOUNT: 123" }], "USD"), "", "多账户匹配时不得自动绑定");
assert.equal(matchImportedPaymentAccount("BANK: A\nACCOUNT: 123", [{ id: "account-1", currency: "EUR", instructions: "BANK: A ACCOUNT: 123" }], "USD"), "", "币种不同不得自动绑定账户");
exampleSheet.J6.v = "EUR";
assert.equal(parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })).document.currency, "EUR", "导入币种以明确填写的币种字段为准，不受缓存表头影响");
exampleSheet.J6.v = "USD";
delete exampleSheet.J6;
assert.throws(() => parseCustomerPiWorkbook(XLSX.write(example, { type: "buffer", bookType: "xlsx" })), /客户付款币种为必填项/, "不得从缓存的美元列头推断未填写的币种");
exampleSheet.J6 = { t: "s", v: "USD" };
assert.throws(() => parseCustomerPiWorkbook(template), /订单编号不能为空/, "未填写必填项不得生成草稿");
exampleSheet.J19 = { t: "n", v: 1.5 };
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
assert.equal(lines.F1.v, "产品质量/描述中文（展示给后端）", "中文描述应选填");
assert.match(lines.J501.f, /H501\*I501/, "500行金额须自动计算");
assert.match(lines.K501.f, /H501-G501/, "500行利润须自动计算");
assert.match(lines.L501.f, /K501\/J501/, "500行利润率须自动计算");
for (const [address, value] of Object.entries({ B3: "Jack Liu", B4: "i-Service", B5: "D6052456", B6: "USD", B7: 6.67, B8: "2026-11-01", B10: "T/T Bank Transfer", B11: "Jack Liu", B12: "+86 1520256556", B13: "jack@example.com", B14: "Dublin", B15: 100, B16: 50, B17: 5, B18: 8, B19: 0, B20: "是" })) {
  basic[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
}
for (const [address, value] of Object.entries({ A2: "LCD", B2: "IPH", C2: "IP17", D2: "OLED", G2: 80, H2: 120, I2: 10 })) {
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
lines.G2 = { t: "n", v: 120 };
assert.throws(() => parseCustomerPiWorkbook(wholeBytes()), /售价必须高于成本/);
lines.G2 = { t: "n", v: 80 };

const wholeHelp = XLSX.utils.sheet_to_json(wholeTemplate.Sheets["PI基本信息"], { header: 1, defval: "" });
assert.match(String(wholeHelp[0][1]), /红色 \* 为必填/);
assert.equal(basic.A4.v, "公司名称（选填）", "公司名称应与创建PI页面一致，不强制填写");
assert.match(String(basic.C4.v), /可留空.*导入后手动选择客户/);
assert.match(String(wholeHelp[10][2]), /启用客户收货信息时必填/);
assert.match(String(wholeHelp[12][0]), /邮箱（选填）/);
assert.match(String(wholeHelp[22][2]), /同币种启用账户中唯一精确匹配.*否则导入后手动选择/);
assert.equal(wholeTemplate.Sheets["PI产品明细"].N1.v, "销售备注", "PI整单模板备注字段须与创建页的销售备注一致");

const optionalWhole = XLSX.readFile("assets/templates/PI_Whole_Order_Import_Template.xlsx", { cellFormula: true });
const optionalBasic = optionalWhole.Sheets["PI基本信息"];
const optionalLines = optionalWhole.Sheets["PI产品明细"];
for (const [address, value] of Object.entries({ B3: "Jack Liu", B5: "D6052457", B6: "USD" })) optionalBasic[address] = { t: "s", v: value };
for (const [address, value] of Object.entries({ A2: "LCD", B2: "IPH", C2: "IP17", D2: "OLED", G2: 80, H2: 120, I2: 10 })) optionalLines[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
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
  XLSX.utils.sheet_to_json(lines, { header: 1, range: "A1:N1" })[0],
  XLSX.utils.sheet_to_json(productSheet, { header: 1, range: "A1:N1" })[0],
  "整单模板与产品明细导入模板须逐列完全一致",
);
assert.equal(productSheet.N1.v, "销售备注");
for (const [address, value] of Object.entries({ A2: "LCD", B2: "IPH", C2: "IP 17 Pro", D2: "OLED", E2: "产品描述", F2: "中文描述", G2: 80, H2: 120, I2: 10, M2: "逐件检查", N2: "销售说明" })) {
  productSheet[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
}
const excelRows = XLSX.utils.sheet_to_json(productSheet, { header: 1, defval: "" });
const excelImported = parsePiProductRows(excelRows, 0.15);
const pastedImported = parsePiProductRows(excelRows.map((row) => row.map((cell) => String(cell ?? ""))), 0.15);
assert.deepEqual(pastedImported, excelImported, "Excel导入与粘贴表格须使用相同字段映射和校验");
assert.equal(excelImported.length, 1);
assert.equal(excelImported[0].item_name, "LCD");
assert.equal(excelImported[0].unit_price_payment, "18.00");
assert.equal(excelImported[0].preparation_requirement, "逐件检查");
assert.equal(excelImported[0].internal_note, "销售说明");
assert.deepEqual(parsePiProductRows([excelRows[1]], 0.15), excelImported, "无表头复制的数据区域仍按标准列序解析");
assert.throws(() => parsePiProductRows([excelRows[2]], 0.15), /1至500条产品明细/, "模板空白公式行不得误判为明细");
assert.throws(() => parsePiProductRows([["LCD", "IPH", "IP17", "OLED", "", "", "", "", "", "", "", "", "", ""]], 0.15), /须填写产品、品牌、型号、质量、整数数量/, "缺少产品必填价格或数量须拒绝");
const formSource = readFileSync("components/pi-order-form.tsx", "utf8");
assert.match(formSource, /parsePiProductRows\(rows, effectiveRate\)/, "PI导入入口须调用共享解析器");
assert.match(formSource, /importRows\(XLSX\.utils\.sheet_to_json/, "Excel上传须进入共享导入处理");
assert.match(formSource, /importRows\(\(await navigator\.clipboard\.readText\(\)\)\.split\(/, "剪贴板粘贴须进入同一共享处理");

const route = readFileSync("app/api/orders/import-template/route.ts", "utf8");
const view = readFileSync("components/pi-import-view.tsx", "utf8");
const conversion = readFileSync("app/api/orders/import-drafts/[id]/convert/route.ts", "utf8");
assert.match(route, /requirePermission\("orders\.import"\)/);
assert.match(readFileSync("app/api/orders/import-drafts/route.ts", "utf8"), /sales_account_email\.toLowerCase\(\) !== account\.email\.toLowerCase\(\)/);
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
assert.match(form, /source\.currency\)\?\.business_cny \|\| 0/, "导入时只采用系统当前业务汇率；缺失时应要求核对，不得使用旧文件汇率自动换算");
assert.match(form, /source\.shipping_payment \* importedRate/, "导入外币运费应按当前业务汇率折算并预填人民币运费");
assert.match(form, /exactCustomerMatches\.length === 1/, "仅在本人公司名称唯一精确匹配时自动关联客户");
assert.match(form, /submitAfterImportDifferences \? "将保存PI并生成备货单"/, "差异核对确认应保留直接提交仓库意图");
assert.match(readFileSync("app/api/orders/import-drafts/route.ts", "utf8"), /matchImportedPaymentAccount[\s\S]*payment_account_id/,
  "付款账户只能服务端唯一精确匹配，并只在导入草稿中保存账户ID而不保留账户明文");
console.log("PI整单导入模板、必填标记、解析校验及待补全流程回归通过。");
