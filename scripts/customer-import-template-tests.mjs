import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import XLSX from "xlsx";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { mapImportRow } = await jiti.import(resolve("lib/import-parser.ts"));
const { sanitizeImportRow } = await jiti.import(resolve("lib/import-safety.ts"));
const { importedCustomerGrade, importedCustomerStage } = await jiti.import(resolve("lib/customers/import-profile.ts"));
const binary = await readFile(resolve("assets/templates/Customer_Import_Template.xlsx"));
const customerListApi = await readFile(resolve("app/api/customers/route.ts"), "utf8");
const customersView = await readFile(resolve("components/customers-view.tsx"), "utf8");
const customerForm = await readFile(resolve("components/customer-form.tsx"), "utf8");
const customerDetail = await readFile(resolve("components/customer-crm-detail-view.tsx"), "utf8");
const customerCreateApi = await readFile(resolve("app/api/customers/route.ts"), "utf8");
const customerEditApi = await readFile(resolve("app/api/customers/[id]/route.ts"), "utf8");
const piCustomerApi = await readFile(resolve("app/api/orders/pi-customers/route.ts"), "utf8");
const piForm = await readFile(resolve("components/pi-order-form.tsx"), "utf8");
assert.match(customerForm, /shipping_address:customer\?\.shipping_address\|\|""/, "编辑客户须回填客户收货地址");
assert.match(customerForm, /<AddressListEditor label="客户收货地址"/, "手动新增及编辑须显示客户收货地址列表");
assert.match(customerForm, /"address","shipping_address","forwarder_address"/, "编辑资料须提交客户收货地址");
assert.match(customerDetail, /displayAddressList\(customer\.shipping_addresses, customer\.shipping_address\)/, "详情须显示客户收货地址列表");
assert.match(customerCreateApi, /"other_address", "shipping_address"/, "手动新增 API 须保存客户收货地址");
assert.match(customerEditApi, /"other_address", "shipping_address"/, "编辑 API 须保存客户收货地址");
assert.match(piCustomerApi, /address,shipping_address,shipping_addresses"\)/, "PI客户选项须读取全部客户收货地址");
assert.match(piForm, /setAddress\(displayAddressList\(customer\.shipping_addresses, customer\.shipping_address\)\[0\] \|\| ""\)/, "PI须默认带入首条客户收货地址");
assert.match(piForm, /aria-label="选择客户收货地址"/, "多条客户收货地址时 PI 应可选择实际配送地址");
assert.match(customerListApi, /manualGrade === "UNMARKED"\) query = query\.is\("manual_grade", null\)/, "客户等级筛选须覆盖未标记客户");
assert.match(customerListApi, /"ai_score", "manual_grade", "status"/, "客户等级应可排序");
assert.match(customersView, /aria-label="客户等级"/, "我的客户应提供客户等级筛选");
const workbook = XLSX.read(binary, { type: "buffer" });
assert.deepEqual(workbook.SheetNames, ["客户导入模板"]);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
const headers = [
  "客户名称*", "公司名称*", "国家*", "电话号码", "邮箱号", "whatsapp号码", "wechat号码",
  "客户税号", "客户阶段", "客户等级", "客户官网", "公司地址", "客户收货地址", "理货要求", "备注",
  "货代地址", "其他地址", "谷歌商家链接", "FB主页链接", "INS主页链接",
  "Tiktok主页链接", "Linked主页链接",
];
assert.deepEqual(rows, [headers], "模板不得预填可能被误导入的示例客户");
const archive = XLSX.CFB.read(binary, { type: "buffer" });
const sheetPath = archive.FullPaths.findIndex((item) => item.endsWith("/xl/worksheets/sheet1.xml"));
assert.ok(sheetPath >= 0);
const xml = archive.FileIndex[sheetPath].content.toString("utf8");
assert.match(xml, /sqref="I2:I1001"[^>]*>.*?潜在客户,意向客户,已成交客户/s);
assert.match(xml, /sqref="J2:J1001"[^>]*>.*?S,A,B,C,D/s);

const sample = Object.fromEntries(headers.map((header) => [header, ""]));
Object.assign(sample, {
  "公司名称*": "测试公司", "客户名称*": "张先生", "国家*": "法国",
  "电话号码": "+33 123456", "邮箱号": "zhang@example.com", "whatsapp号码": "+33 987654",
  "wechat号码": "contact123", "客户税号": "FR123", "客户阶段": "意向客户", "客户等级": "S",
  "公司地址": "巴黎", "客户收货地址": "巴黎收货仓", "客户官网": "https://example.com", "理货要求": "逐件核对",
  "备注": "优先邮件", "货代地址": "里昂仓", "其他地址": "马赛仓",
  "谷歌商家链接": "https://maps.google.com/?cid=123",
  "FB主页链接": "https://facebook.com/example", "INS主页链接": "https://instagram.com/example",
  "Tiktok主页链接": "https://tiktok.com/@example", "Linked主页链接": "https://linkedin.com/company/example",
});
const mapped = mapImportRow(sample);
const safe = sanitizeImportRow(mapped);
for (const [field, expected] of Object.entries({
  company_name: "测试公司", contact_name: "张先生", country: "法国", phone: "+33 123456",
  email: "zhang@example.com", whatsapp: "+33 987654", wechat: "contact123",
  tax_number: "FR123", import_stage: "意向客户", manual_grade: "S",
  address: "巴黎", shipping_address: "巴黎收货仓", website: "https://example.com", tally_requirements: "逐件核对",
  notes: "优先邮件", forwarder_address: "里昂仓", other_address: "马赛仓",
  google_url: "https://maps.google.com/?cid=123", facebook_url: "https://facebook.com/example",
  instagram_url: "https://instagram.com/example", tiktok_url: "https://tiktok.com/@example",
  linkedin_url: "https://linkedin.com/company/example",
})) {
  assert.equal(safe[field], expected, `模板列应可靠映射并通过服务端白名单：${field}`);
}
assert.equal(mapImportRow({ "客户名称*": "张先生", "国家*": "法国" }).company_name, "", "客户名称不可误当公司名称");
assert.equal(mapImportRow({ "公司名称*": "", "客户名称*": "张先生" }).company_name, "", "公司名称为空不可回退到客户名称");
assert.equal(importedCustomerStage("", "PRIVATE", "", ""), "CLAIMED");
assert.equal(importedCustomerStage("潜在客户", "PRIVATE", "", ""), "CLAIMED");
assert.equal(importedCustomerStage("意向客户", "PRIVATE", "123", "a@example.com"), "FOLLOWING");
assert.equal(importedCustomerStage("已成交客户", "PRIVATE", "123", "a@example.com"), "DEAL");
assert.equal(importedCustomerStage("", "PUBLIC_POOL", "", ""), "UNCLAIMED");
assert.throws(() => importedCustomerStage("意向客户", "PRIVATE", "123", ""), /联系电话和邮箱/);
assert.throws(() => importedCustomerStage("已成交客户", "PRIVATE", "", "a@example.com"), /联系电话和邮箱/);
assert.throws(() => importedCustomerStage("成交客户", "PRIVATE", "123", "a@example.com"), /客户阶段只能/);
assert.throws(() => importedCustomerStage("toString", "PRIVATE", "123", "a@example.com"), /客户阶段只能/);
assert.throws(() => importedCustomerStage("意向客户", "PUBLIC_POOL", "123", "a@example.com"), /客户公海不能/);
for (const grade of ["S", "A", "B", "C", "D"]) assert.equal(importedCustomerGrade(grade, "PRIVATE"), grade);
assert.equal(importedCustomerGrade("", "PRIVATE"), null);
assert.throws(() => importedCustomerGrade("E", "PRIVATE"), /客户等级只能/);
assert.throws(() => importedCustomerGrade("S", "PUBLIC_POOL"), /客户公海不能/);
console.log("客户导入模板表头、下拉选项及 22 列映射检查通过。");
