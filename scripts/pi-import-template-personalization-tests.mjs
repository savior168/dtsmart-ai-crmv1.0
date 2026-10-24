import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { buildPiImportTemplate, piImportTemplateExcelDate } from "../lib/pi-import-template.ts";
import { parseCustomerPiWorkbook } from "../lib/pi-document-import.ts";

const original = readFileSync("assets/templates/PI_Import_Template.xlsx");
const seller = { id: "seller-1", name: "Eva", email: "eva@example.com", business_phone: "+86 13800000001", business_email: "pi-eva@example.com" };
const anotherSeller = { id: "seller-2", name: "Sini", email: "sini@example.com", business_phone: "+86 13800000002", business_email: "pi-sini@example.com" };
const customer = { id: "customer-1", owner_id: seller.id, company_name: "Example Buyer Co.", contact_name: "Alex Buyer", phone: "+1 555 0100", tax_number: "VAT123", email: "buyer@example.com", address: "1 Test Street" };
const anotherCustomer = { id: "customer-2", owner_id: anotherSeller.id, company_name: "Other Buyer Co.", contact_name: "Other Contact", phone: "+44 555 0100", tax_number: "GB456", email: "other@example.com", address: "2 Test Street" };
const now = new Date("2026-10-24T02:00:00.000Z");

const sellerBytes = buildPiImportTemplate(original, {
  now,
  sellers: [seller],
  seller,
  customers: [customer],
  allowSellerSelection: false,
});
const sellerBook = XLSX.read(sellerBytes, { type: "buffer", cellFormula: true, cellStyles: true });
const sellerSheet = sellerBook.Sheets.PI;
assert.equal(sellerSheet.D7.v, "Sales Manager: Eva");
assert.equal(sellerSheet.D8.v, "Contact No: +86 13800000001");
assert.equal(sellerSheet.D9.v, "Email: pi-eva@example.com");
assert.equal(sellerSheet.O7.v, "eva@example.com");
assert.equal(sellerSheet.D10?.v || "", "", "个性化销售员模板不再显示重复的登录邮箱行");
assert.equal(sellerSheet.H9?.v || "", "", "付款渠道标签应从PI导入模板移除");
assert.equal(sellerSheet.K9?.v || "", "", "付款渠道留到PI草稿核对，不应预填");
assert.match(sellerSheet.A40.v, /付款渠道、收款账户及 PayPal 手续费请在导入后的 PI 草稿中核对补全/,
  "模板说明应明确付款渠道、收款账户和PayPal费用在草稿补全");
assert.equal(sellerSheet.K4.v, 46324, "报价有效期应按上海日期计算为下载日加5天");
assert.equal(piImportTemplateExcelDate(now), "2026-10-29");
assert.equal(sellerSheet.A14.f.includes("VLOOKUP"), true);
assert.equal(sellerSheet.D15.f.includes("VLOOKUP"), true);
assert.equal(sellerSheet.O13.f.includes("VLOOKUP"), true);
const sellerZip = XLSX.CFB.read(sellerBytes, { type: "buffer" });
assert.ok(XLSX.CFB.find(sellerZip, "/xl/media/image.png"), "个性化模板必须保留公司标识");
const sellerSheetXml = Buffer.from(XLSX.CFB.find(sellerZip, "/xl/worksheets/sheet1.xml").content).toString("utf8");
assert.match(sellerSheetXml, /dataValidation[^>]*sqref="A13"/, "客户字段应保留当前销售员客户下拉");
assert.match(sellerSheetXml, /type="date"[^>]*sqref="K4"/, "有效期应限制为有效日期");
assert.match(sellerSheetXml, /hidden="1"[^>]*ht="0"/, "模板辅助数据区域应隐藏但不受工作表保护");
assert.doesNotMatch(sellerSheetXml, /sheetProtection/, "模板所有单元格必须保持可编辑");
assert.match(sellerSheetXml, /<x:conditionalFormatting sqref="G33:M33"><x:cfRule type="expression" dxfId="0"[^>]*><x:formula>\$K\$9&lt;&gt;&quot;PayPal&quot;<\/x:formula>/,
  "未选择PayPal时手续费行应通过条件格式整体隐藏");
assert.match(sellerSheetXml, /r="G33"[^>]*><x:f>IF\(\$K\$9="PayPal"/,
  "手续费标签只在选择PayPal时显示，默认比例为5%");
assert.match(sellerSheetXml, /r="L33"[^>]*><x:f>IF\(\$K\$9="PayPal"/,
  "PayPal手续费人民币金额应按费用加减后比例计算，其他付款方式为空");
assert.match(sellerSheetXml, /r="M33"[^>]*><x:f>IF\(\$K\$9="PayPal"/,
  "PayPal手续费外币金额应按费用加减后比例计算，其他付款方式为空");
assert.match(sellerSheetXml, /<x:row r="35"[^>]*(?:hidden="1"[^>]*ht="0"|ht="0"[^>]*hidden="1")/,
  "付款信息区应从PI导入模板页面隐藏");
assert.match(sellerSheetXml, /<x:row r="39"[^>]*(?:hidden="1"[^>]*ht="0"|ht="0"[^>]*hidden="1")/,
  "签名区应从PI导入模板页面隐藏");
assert.doesNotMatch(sellerSheetXml, /<x:dataValidation[^>]*sqref="K9"/,
  "PI导入模板不应再提供付款渠道下拉");
assert.match(sellerSheetXml, /<x:dataValidation[^>]*sqref="K29:K32"/,
  "运费、未付款和其他费用/折扣币种下拉必须保留");
const sellerStyles = Buffer.from(XLSX.CFB.find(sellerZip, "/xl/styles.xml").content).toString("utf8");
assert.match(sellerStyles, /<x:dxfs count="1"><x:dxf><x:font><x:color rgb="FFFFFFFF"\s*\/><\/x:font><\/x:dxf><\/x:dxfs>/,
  "PayPal非选中时隐藏文字样式应保留原有工作簿样式");

const clerkBytes = buildPiImportTemplate(original, {
  now,
  sellers: [seller, anotherSeller],
  customers: [customer, anotherCustomer],
  allowSellerSelection: true,
});
const clerkBook = XLSX.read(clerkBytes, { type: "buffer", cellFormula: true });
const clerkSheet = clerkBook.Sheets.PI;
assert.equal(clerkSheet.D7.v, "Sales Manager: ", "跟单员应先在下拉项中选择PI所属销售员");
assert.match(clerkSheet.D8.f, /VLOOKUP/);
assert.match(clerkSheet.D9.f, /VLOOKUP/);
assert.match(clerkSheet.O7.f, /VLOOKUP/);
const clerkXml = Buffer.from(XLSX.CFB.find(XLSX.CFB.read(clerkBytes, { type: "buffer" }), "/xl/worksheets/sheet1.xml").content).toString("utf8");
assert.match(clerkXml, /sqref="D7"/, "跟单员模板必须提供销售员下拉");
assert.match(clerkXml, /OFFSET\(\$W\$42,MATCH\(VLOOKUP\(\$D\$7/, "跟单员客户下拉必须依照所选销售员切换");
assert.match(clerkXml, /sini@example\.com/, "选择列表需要提供当前有效销售账号以便核验");

// Simulate an Excel client recalculating and saving the generated formulas after selections.
const filled = XLSX.read(clerkBytes, { type: "buffer", cellFormula: true });
const sheet = filled.Sheets.PI;
const put = (address, value) => { sheet[address] = typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value }; };
put("K2", "CODEX-PI-TEMPLATE-E2E-1");
put("K6", "USD");
put("K7", 6.668);
put("K8", "2026-11-02");
put("K9", "PayPal");
put("D7", "Sales Manager: Sini");
put("D8", "Contact No: +86 13800000002");
put("D9", "Email: pi-sini@example.com");
put("O7", "sini@example.com");
put("A13", "Company: Other Buyer Co. · Other Contact · +44 555 0100 · custome");
put("A14", "Tax No.: GB456");
put("A15", "To*: Other Contact");
put("D15", "TEL*: +44 555 0100");
put("A16", "Email: other@example.com");
put("G13", "Delivery address*: 2 Test Street");
put("O13", "Other Buyer Co.");
for (const [column, value] of Object.entries({ B: "LCD", D: "IPH", E: "IP 17 Pro", F: "OLED", G: "120HZ", I: 285, K: 1 })) put(`${column}19`, value);
put("J19", 42.74);
put("L19", 285);
put("M19", 42.74);
const imported = parseCustomerPiWorkbook(XLSX.write(filled, { type: "buffer", bookType: "xlsx" })).document;
assert.equal(imported.warehouse_reference_number, "CODEX-PI-TEMPLATE-E2E-1");
assert.equal(imported.sales_account_email, "sini@example.com", "导入身份应由隐藏模板字段保存并交由服务端复验");
assert.equal(imported.seller_contact_name, "Sini");
assert.equal(imported.seller_contact_phone, "+86 13800000002");
assert.equal(imported.seller_contact_email, "pi-sini@example.com");
assert.equal(imported.delivery_company, "Other Buyer Co.", "下拉显示项不能污染解析出的公司名称");
assert.equal(imported.delivery_recipient, "Other Contact");
assert.equal(imported.delivery_phone, "+44 555 0100");
assert.equal(imported.delivery_email, "other@example.com");
assert.equal(imported.delivery_address, "2 Test Street");
assert.equal(imported.items[0].unit_price_cny, 285);
assert.equal(imported.items[0].unit_price_payment, 42.74);

function parseFeeScenario(paymentMethod) {
  const feeBook = XLSX.read(clerkBytes, { type: "buffer", cellFormula: true });
  const feeSheet = feeBook.Sheets.PI;
  const set = (address, value) => { feeSheet[address] = value === "" ? { t: "s", v: "" } : typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value }; };
  for (const [address, value] of Object.entries({
    K2: "CODEX-PI-FEES-E2E", K6: "USD", K7: 6.668, K8: "2026-11-02", K9: paymentMethod,
    D7: "Sales Manager: Sini", D8: "Contact No: +86 13800000002", D9: "Email: pi-sini@example.com", O7: "sini@example.com",
    A13: "Company: Other Buyer Co. · Other Contact · +44 555 0100 · custome", A14: "Tax No.: GB456", A15: "To*: Other Contact",
    D15: "TEL*: +44 555 0100", A16: "Email: other@example.com", G13: "Delivery address*: 2 Test Street", O13: "Other Buyer Co.",
    B19: "LCD", D19: "IPH", E19: "IP 17 Pro", F19: "OLED", G19: "120HZ", I19: 285, J19: 42.74, K19: 1, L19: 285, M19: 42.74,
    K29: "CNY", L29: 100, M29: 15, K30: "外币", L30: 66.68, M30: 10,
    K31: "CNY", L31: 20, M31: 3, K32: "外币", L32: 6.67, M32: 1, K33: 5,
  })) set(address, value);
  if (paymentMethod === "PayPal") {
    set("G33", "PAYPAL FEE (5%):"); set("L33", 23.25); set("M33", 3.49);
    set("L34", 488.26); set("M34", 73.23);
  } else {
    set("G33", ""); set("L33", ""); set("M33", "");
    set("L34", 465.01); set("M34", 69.74);
  }
  return parseCustomerPiWorkbook(XLSX.write(feeBook, { type: "buffer", bookType: "xlsx" })).document;
}

const paypalImported = parseFeeScenario("PayPal");
assert.equal(paypalImported.payment_method, "PayPal");
assert.equal(paypalImported.paypal_rate_percent, 5, "PayPal导入应保留默认5%手续费比例");
assert.equal(paypalImported.shipping_cny, 100, "CNY运费应正确导入");
assert.equal(paypalImported.last_balance_payment, 10, "外币未付尾款应正确导入");
assert.equal(paypalImported.last_balance_cny, 66.68, "外币未付尾款应按汇率换算成人民币");
assert.equal(paypalImported.other_cny, 20, "其他费用应按加法输入正确导入");
assert.equal(paypalImported.discount_payment, 1, "折扣应按减法方向正确导入");
assert.equal(paypalImported.discount_cny, 6.67, "外币折扣应换算成人民币");
assert.equal(paypalImported.total_payment, 73.23, "PayPal手续费应按其他费用加减后的5%计入总额");
const nonPaypalImported = parseFeeScenario("");
assert.equal(nonPaypalImported.payment_method, "", "付款渠道应留待PI草稿补全");
assert.equal(nonPaypalImported.paypal_rate_percent, 5, "未选择付款渠道时应把默认5%带到PI草稿供后续使用");
assert.equal(nonPaypalImported.total_payment, 69.74, "非PayPal PI总额不应包含PayPal手续费");
const piForm = readFileSync("components/pi-order-form.tsx", "utf8");
assert.match(piForm, /if \(source\.paypal_rate_percent !== undefined\) setPaypalRateInput\(String\(source\.paypal_rate_percent\)\)/,
  "PI草稿页应接收导入模板默认的PayPal费率");
assert.match(piForm, /if \(source\.payment_method\) \{[\s\S]*?setPaymentMethod\(source\.payment_method\)/,
  "导入模板未填写付款渠道时PI草稿页应留空供用户选择");
assert.match(piForm, /setFeeFields\(\{[\s\S]*?last_balance:[\s\S]*?discount:[\s\S]*?other:/,
  "PI草稿页应分别回填未付尾款、折扣和其他费用");
assert.match(piForm, /setItems\(source\.items\.map\(\(item\) => \(\{[\s\S]*?item_name: item\.item_name[\s\S]*?unit_price_cny:[\s\S]*?estimated_unit_cost_cny:/,
  "PI草稿页应回填导入的产品名称、双币售价、成本和明细字段");

console.log("PI导入模板个性化、付款信息留空、PayPal费用规则、双币费用换算及导入字段闭环回归通过。");
