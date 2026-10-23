import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import XLSX from "xlsx";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { importDeliveryContactError, mapImportRow, parseImportFile } = await jiti.import(resolve("lib/import-parser.ts"));
const { sanitizeImportRow } = await jiti.import(resolve("lib/import-safety.ts"));
const { importedCustomerGrade, importedCustomerStage } = await jiti.import(resolve("lib/customers/import-profile.ts"));
const { customerImportIdentityKeys } = await jiti.import(resolve("lib/import-dedupe.ts"));
const binary = await readFile(resolve("assets/templates/Customer_Import_Template.xlsx"));
const poolBinary = await readFile(resolve("assets/templates/Customer_Public_Pool_Import_Template.xlsx"));
const templateApi = await readFile(resolve("app/api/import/template/route.ts"), "utf8");
const importApi = await readFile(resolve("app/api/import/route.ts"), "utf8");
const importView = await readFile(resolve("components/import-view.tsx"), "utf8");
const customerListApi = await readFile(resolve("app/api/customers/route.ts"), "utf8");
const customersView = await readFile(resolve("components/customers-view.tsx"), "utf8");
const customerForm = await readFile(resolve("components/customer-form.tsx"), "utf8");
const customerDetail = await readFile(resolve("components/customer-crm-detail-view.tsx"), "utf8");
const customerCreateApi = await readFile(resolve("app/api/customers/route.ts"), "utf8");
const customerEditApi = await readFile(resolve("app/api/customers/[id]/route.ts"), "utf8");
const piCustomerApi = await readFile(resolve("app/api/orders/pi-customers/route.ts"), "utf8");
const piForm = await readFile(resolve("components/pi-order-form.tsx"), "utf8");
assert.match(customerForm, /shipping_address:customer\?\.shipping_address\|\|""/, "编辑客户须回填客户收货地址");
assert.match(customerForm, /<ShippingContactEditor label="客户收货信息" values=\{shippingContacts\}/, "手动新增及编辑须显示结构化客户收货信息");
assert.match(customerForm, /<ShippingContactEditor label="货代收货信息" values=\{forwarderContacts\}/, "货代收货信息须使用同样的三字段结构");
assert.match(customerForm, /"address","shipping_address","forwarder_address"/, "编辑资料须提交客户收货地址");
assert.match(customerDetail, /displayAddressList\(customer\.shipping_addresses, customer\.shipping_address\)/, "详情须显示客户收货地址列表");
assert.match(customerCreateApi, /"other_address", "shipping_address"/, "手动新增 API 须保存客户收货地址");
assert.match(customerEditApi, /"other_address", "shipping_address"/, "编辑 API 须保存客户收货地址");
assert.match(piCustomerApi, /address,shipping_address,shipping_addresses,shipping_contact_entries,forwarder_addresses,forwarder_contact_entries"\)/, "PI客户选项须读取客户与货代的结构化收货信息");
assert.match(piForm, /setAddress\(chosen\?\.address \|\| ""\)/, "勾选后仅在单条收货信息时自动带入地址");
assert.match(piForm, /aria-label="选择客户收货地址"/, "多条客户收货地址时 PI 应可选择实际配送地址");
assert.match(customerListApi, /manualGrade === "UNMARKED"\) query = query\.is\("manual_grade", null\)/, "客户等级筛选须覆盖未标记客户");
assert.match(customerListApi, /"ai_score", "manual_grade", "status"/, "客户等级应可排序");
assert.match(customersView, /aria-label="客户等级"/, "我的客户应提供客户等级筛选");
const workbook = XLSX.read(binary, { type: "buffer" });
const poolWorkbook = XLSX.read(poolBinary, { type: "buffer" });
assert.deepEqual(workbook.SheetNames, ["客户导入模板", "填写说明", "填写示例"]);
assert.deepEqual(poolWorkbook.SheetNames, ["客户导入模板", "填写说明", "填写示例"]);
const exampleRows = XLSX.utils.sheet_to_json(workbook.Sheets["填写示例"], { header: 1, defval: "" });
assert.match(exampleRows[0][0], /不会导入/);
assert.equal(exampleRows[4][0], "示例联系人");
assert.equal(exampleRows[4][8], "", "示例不得预设客户阶段");
const help = XLSX.utils.sheet_to_json(workbook.Sheets["填写说明"], { header: 1, defval: "" });
assert.match(help[3][1], /仅“客户名称”和“国家\/地区”必填/);
assert.match(help[6][1], /均为选填，收货人、电话、地址可分别填写/);
assert.match(help[4][1], /阶段不是必填项/);
assert.match(help[9][1], /列名为系统标准字段，请勿更改、删除、合并或调换/);
const poolHelp = XLSX.utils.sheet_to_json(poolWorkbook.Sheets["填写说明"], { header: 1, defval: "" });
assert.match(poolHelp[4][1], /统一进入公海“待认领”状态/);
assert.match(poolHelp[6][1], /均为选填，收货人、电话、地址可分别填写/);
assert.match(poolHelp[5][1], /仅保留为来源信息/);
assert.match(poolHelp[9][1], /列名为系统标准字段，请勿更改、删除、合并或调换/);
assert.deepEqual(await parseImportFile(new File([binary], "客户导入模板.xlsx")), [], "空白客户数据页与说明页不能被识别为客户记录");
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
const headers = [
  "客户名称*", "公司名称", "国家*", "电话号码", "邮箱号", "whatsapp号码", "wechat号码",
  "客户税号", "客户阶段", "客户等级", "客户官网", "公司地址", "收货人（客户）", "收货电话（客户）", "收货地址（客户）", "理货要求", "备注",
  "收货人（货代）", "收货电话（货代）", "收货地址（货代）", "其他地址", "谷歌商家链接", "FB主页链接", "INS主页链接",
  "Tiktok主页链接", "Linked主页链接",
];
assert.deepEqual(rows[0], headers, "模板标准列名及顺序必须固定");
assert.ok(rows.slice(1).every((row) => row.every((value) => value === "")), "模板数据区不得预填可能被误导入的示例客户");
const poolHeaders = XLSX.utils.sheet_to_json(poolWorkbook.Sheets["客户导入模板"], { header: 1, defval: "" })[0];
assert.deepEqual(poolHeaders, headers.filter((_, index) => index !== 8 && index !== 9), "公海模板应移除阶段、等级列，其他标准列保持一致");
assert.ok(!poolHeaders.some((header) => /客户阶段|客户等级/.test(header)));
assert.match(templateApi, /Customer_Public_Pool_Import_Template/);
assert.match(importView, /api\/import\/template\?destination=\$\{destination\}/);
const archive = XLSX.CFB.read(binary, { type: "buffer" });
const sheetPath = archive.FullPaths.findIndex((item) => item.endsWith("/xl/worksheets/sheet1.xml"));
assert.ok(sheetPath >= 0);
const xml = archive.FileIndex[sheetPath].content.toString("utf8").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
assert.match(xml, /sqref="I2:I1001"[^>]*>.*?潜在客户,意向客户,已成交客户/s);
assert.match(xml, /sqref="J2:J1001"[^>]*>.*?S,A,B,C,D/s);

const sample = Object.fromEntries(headers.map((header) => [header, ""]));
Object.assign(sample, {
  "公司名称": "测试公司", "客户名称*": "张先生", "国家*": "法国",
  "电话号码": "+33 123456", "邮箱号": "zhang@example.com", "whatsapp号码": "+33 987654",
  "wechat号码": "contact123", "客户税号": "FR123", "客户阶段": "意向客户", "客户等级": "S",
  "公司地址": "巴黎", "收货地址（客户）": "巴黎收货仓", "客户官网": "https://example.com", "理货要求": "逐件核对",
  "收货人（客户）": "张先生", "收货电话（客户）": "+33 12345678", "备注": "优先邮件",
  "收货人（货代）": "李先生", "收货电话（货代）": "+33 87654321", "收货地址（货代）": "里昂仓", "其他地址": "马赛仓",
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
assert.deepEqual(safe.shipping_contact_entries, [{ recipient: "张先生", phone: "+33 12345678", address: "巴黎收货仓" }], "新模板的客户收货三字段须映射为结构化客户资料");
assert.deepEqual(safe.forwarder_contact_entries, [{ recipient: "李先生", phone: "+33 87654321", address: "里昂仓" }], "新模板的货代收货三字段须映射为结构化客户资料");
assert.equal(importDeliveryContactError(sample), "", "完整收货信息可通过预览校验");
assert.equal(importDeliveryContactError({ "收货人（客户）": "张先生" }), "", "客户收货人可单独填写保存");
assert.equal(importDeliveryContactError({ "收货电话（货代）": "+33 87654321" }), "", "货代收货电话可单独填写保存");
assert.match(importDeliveryContactError({ "收货人（客户）": "张先生", "收货电话（客户）": "123456", "收货地址（客户）": "巴黎" }), /电话须为有效/);
const legacyMapped = sanitizeImportRow(mapImportRow({ "客户名称*": "旧模板客户", "国家*": "法国", "客户收货地址": "旧客户地址", "货代地址": "旧货代地址", "其他地址": "旧备用地址" }));
assert.equal(legacyMapped.shipping_address, "旧客户地址", "旧模板客户收货地址列仍须兼容");
assert.equal(legacyMapped.forwarder_address, "旧货代地址", "旧模板货代地址列仍须兼容");
assert.equal(legacyMapped.other_address, "旧备用地址", "旧模板其他地址列仍须兼容");
assert.equal(legacyMapped.shipping_contact_entries, undefined, "旧版地址列不得伪造收货人和电话");
assert.equal(legacyMapped.forwarder_contact_entries, undefined, "旧版货代地址列不得伪造收件人和电话");
assert.equal(importDeliveryContactError(legacyMapped), "", "旧版地址-only 数据仍可正常导入");
assert.equal(mapImportRow({ "客户名称*": "张先生", "国家*": "法国" }).company_name, "", "客户名称不可误当公司名称");
assert.equal(mapImportRow({ "公司名称": "", "客户名称*": "张先生" }).company_name, "", "公司名称为空不可回退到客户名称");
assert.equal(importedCustomerStage("", "PRIVATE"), "CLAIMED");
assert.equal(importedCustomerStage("潜在客户", "PRIVATE"), "CLAIMED");
assert.equal(importedCustomerStage("意向客户", "PRIVATE"), "FOLLOWING");
assert.equal(importedCustomerStage("已成交客户", "PRIVATE"), "DEAL");
assert.equal(importedCustomerStage("意向客户", "PUBLIC_POOL"), "UNCLAIMED");
assert.throws(() => importedCustomerStage("成交客户", "PRIVATE"), /客户阶段只能/);
assert.throws(() => importedCustomerStage("toString", "PRIVATE"), /客户阶段只能/);
for (const grade of ["S", "A", "B", "C", "D"]) assert.equal(importedCustomerGrade(grade, "PRIVATE"), grade);
assert.equal(importedCustomerGrade("", "PRIVATE"), null);
assert.throws(() => importedCustomerGrade("E", "PRIVATE"), /客户等级只能/);
assert.equal(importedCustomerGrade("S", "PUBLIC_POOL"), "S", "公海导入将等级作为来源字段保存，不用于系统等级");
const importedRows = Array.from({ length: 13 }, (_, index) => ({
  company_name: `Company ${index + 1}`, contact_name: `Contact ${index + 1}`, country: "France",
  email: "shared@example.com", phone: index === 0 ? "+33123456789" : "", website: "", google_url: "",
}));
const importSeen = new Set();
for (const row of importedRows) {
  const keys = customerImportIdentityKeys(row);
  assert.ok(!keys.some((key) => importSeen.has(key)), "共享邮箱不能把不同客户行合并");
  keys.forEach((key) => importSeen.add(key));
}
assert.equal(importedRows.length, 13, "13 条不同联系人/公司且共享邮箱的数据应全部通过文件内去重");
assert.match(importApi, /if \(!text\(item\.contact_name\)\)/);
assert.match(importApi, /if \(!text\(item\.country\)\)/);
assert.doesNotMatch(importApi, /if \(!text\(item\.company_name\)\)/);
assert.doesNotMatch(importApi, /缺少电话、邮箱、官网或 Google 地图联系方式/);
assert.match(importApi, /source_stage_label = sourceStageLabel/);
assert.match(importApi, /status: "UNCLAIMED"/);
console.log("客户导入模板表头、下拉选项及结构化地址兼容映射检查通过。");
