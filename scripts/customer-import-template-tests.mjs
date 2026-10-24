import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import XLSX from "xlsx";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { importDeliveryContactError, mapImportRow, parseImportFile } = await jiti.import(resolve("lib/import-parser.ts"));
const { sanitizeImportRow } = await jiti.import(resolve("lib/import-safety.ts"));
const { importedCustomerGrade, importedCustomerStage } = await jiti.import(resolve("lib/customers/import-profile.ts"));
const { CUSTOMER_GRADE_OPTIONS, CUSTOMER_GRADE_DESCRIPTIONS, CUSTOMER_GRADE_FILTER_LABELS, customerGradeDescription, isCustomerGrade } = await jiti.import(resolve("lib/customers/customer-grade.ts"));
const { customerImportIdentityKeys } = await jiti.import(resolve("lib/import-dedupe.ts"));
const { customerStageContactError } = await jiti.import(resolve("lib/customer-contact-requirement.ts"));
const binary = await readFile(resolve("assets/templates/Customer_Import_Template.xlsx"));
const poolBinary = await readFile(resolve("assets/templates/Customer_Public_Pool_Import_Template.xlsx"));
const templateApi = await readFile(resolve("app/api/import/template/route.ts"), "utf8");
const importApi = await readFile(resolve("app/api/import/route.ts"), "utf8");
const workflowApi = await readFile(resolve("app/api/customers/[id]/workflow/route.ts"), "utf8");
const importView = await readFile(resolve("components/import-view.tsx"), "utf8");
const customerListApi = await readFile(resolve("app/api/customers/route.ts"), "utf8");
const customersView = await readFile(resolve("components/customers-view.tsx"), "utf8");
const customerForm = await readFile(resolve("components/customer-form.tsx"), "utf8");
const customerTypes = await readFile(resolve("lib/types.ts"), "utf8");
const customerDetail = await readFile(resolve("components/customer-crm-detail-view.tsx"), "utf8");
const customerCreateApi = await readFile(resolve("app/api/customers/route.ts"), "utf8");
const customerEditApi = await readFile(resolve("app/api/customers/[id]/route.ts"), "utf8");
const piCustomerApi = await readFile(resolve("app/api/orders/pi-customers/route.ts"), "utf8");
const piForm = await readFile(resolve("components/pi-order-form.tsx"), "utf8");
assert.match(customerForm, /shipping_address:customer\?\.shipping_address\|\|""/, "编辑客户须回填客户收货地址");
assert.match(customerForm, /<ShippingContactEditor label="客户收货信息" values=\{shippingContacts\}/, "手动新增及编辑须显示结构化客户收货信息");
assert.match(customerForm, /<ShippingContactEditor label="货代收货信息" values=\{forwarderContacts\}/, "货代收货信息须使用同样的三字段结构");
assert.match(customerForm, /CUSTOMER_GRADE_OPTIONS\.map\(\(grade\)/, "手动新增客户须提供七档客户等级");
assert.match(customerTypes, /manual_grade\?: CustomerGrade \| null/, "Customer 类型须与七档等级共享定义");
assert.doesNotMatch(customerForm, /includes\(stage\)/, "客户等级/联系方式提示不得引用未定义阶段变量");
assert.match(customerForm, /title=\{customerGradeDescription\(form\.manual_grade\)\}/, "手动客户等级须悬浮显示业绩区间");
assert.match(customersView, /title=\{customerGradeDescription\(customer\.manual_grade\)\}/, "客户列表等级字母须悬浮显示业绩区间");
assert.match(customerDetail, /title=\{customerGradeDescription\(customer\.manual_grade\)\}/, "客户详情等级字母须悬浮显示业绩区间");
assert.match(importView, /isCustomerGrade\(item\.manual_grade\)/, "批量导入预览须使用统一等级校验");
assert.match(importView, /customerGradeDescription\(row\.manual_grade\)/, "批量导入预览等级须悬浮显示业绩区间");
assert.match(customerCreateApi, /normalizeCustomerGrade\(body\.manual_grade\)/, "手动新增服务端须校验并规范化等级");
assert.match(customerEditApi, /normalizeCustomerGrade\(payload\.manual_grade\)/, "编辑客户服务端须校验并规范化等级");
assert.match(customerListApi, /isCustomerGrade\(manualGrade\)/, "客户列表筛选 API 须支持统一的等级集合");
assert.match(customerForm, /"address","shipping_address","forwarder_address"/, "编辑资料须提交客户收货地址");
assert.match(customerDetail, /displayAddressList\(customer\.shipping_addresses, customer\.shipping_address\)/, "详情须显示客户收货地址列表");
assert.match(customerCreateApi, /"other_address", "shipping_address"/, "手动新增 API 须保存客户收货地址");
assert.match(customerEditApi, /"other_address", "shipping_address"/, "编辑 API 须保存客户收货地址");
assert.match(piCustomerApi, /address,shipping_address,shipping_addresses,shipping_contact_entries,forwarder_addresses,forwarder_contact_entries"\)/, "PI客户选项须读取客户与货代的结构化收货信息");
assert.match(piForm, /setAddress\(chosen\?\.address \|\| ""\)/, "勾选后仅在单条收货信息时自动带入地址");
assert.match(piForm, /aria-label="选择客户资料中的客户收货信息"/, "多条客户收货地址时 PI 应可选择实际配送地址");
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
assert.match(help[4][1], /客户阶段不是必填项/);
assert.match(help[4][1], /已成交客户.*微信、邮箱或电话其中一项/);
assert.match(help[4][1], /只填一项即可/);
assert.match(help[5][1], /S.*50,000/);
assert.match(help[5][1], /KA.*30,000.*50,000/);
assert.match(help[5][1], /MA.*10,000.*30,000/);
assert.match(help[5][1], /A.*8,000.*10,000/);
assert.match(help[5][1], /B.*5,000.*8,000/);
assert.match(help[5][1], /C.*2,000.*5,000/);
assert.match(help[5][1], /D.*2,000/);
assert.match(help[9][1], /列名为系统标准字段，请勿更改、删除、合并或调换/);
const poolHelp = XLSX.utils.sheet_to_json(poolWorkbook.Sheets["填写说明"], { header: 1, defval: "" });
assert.match(poolHelp[4][1], /统一进入公海“待认领”状态/);
assert.match(poolHelp[6][1], /均为选填，收货人、电话、地址可分别填写/);
assert.match(poolHelp[5][1], /仅保留为来源信息/);
assert.match(poolHelp[9][1], /列名为系统标准字段，请勿更改、删除、合并或调换/);
assert.deepEqual(await parseImportFile(new File([binary], "客户导入模板.xlsx")), [], "空白客户数据页与说明页不能被识别为客户记录");
for (const [name, source] of [["我的客户", binary], ["客户公海", poolBinary]]) {
  const filled = XLSX.read(source, { type: "buffer" });
  XLSX.utils.sheet_add_aoa(filled.Sheets["客户导入模板"], [["测试联系人", "测试公司", "法国"]], { origin: "A11" });
  const filledBinary = XLSX.write(filled, { bookType: "xlsx", type: "buffer" });
  const parsed = await parseImportFile(new File([filledBinary], `${name}填写测试.xlsx`));
  assert.equal(parsed.length, 1, `${name}的数据行须能填写并被导入解析`);
  assert.equal(parsed[0]["客户名称*"], "测试联系人");
  assert.equal(parsed[0]["国家*"], "法国");
}
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

function getSheetXml(buffer) {
  const archive = XLSX.CFB.read(buffer, { type: "buffer" });
  const index = archive.FullPaths.findIndex((item) => item.endsWith("/xl/worksheets/sheet1.xml"));
  assert.ok(index >= 0, "导入工作表XML必须存在");
  return archive.FileIndex[index].content.toString("utf8");
}
function getCellStyle(xml, address) {
  return xml.match(new RegExp('<c r="' + address + '" s="(\\d+)"'))?.[1];
}
const privateTemplateXml = getSheetXml(binary);
const poolTemplateXml = getSheetXml(poolBinary);
for (const [name, xml] of [["我的客户", privateTemplateXml], ["客户公海", poolTemplateXml]]) {
  const requiredStyle = getCellStyle(xml, "A1");
  const countryStyle = getCellStyle(xml, "C1");
  const companyStyle = getCellStyle(xml, "B1");
  assert.ok(requiredStyle && countryStyle && companyStyle, name + " 表头必须有明确格式");
  assert.equal(requiredStyle, countryStyle, name + " 客户名称和国家使用统一必填标记");
  assert.equal(companyStyle, getCellStyle(xml, "D1"), name + " 公司名称应使用选填列样式");
  assert.notEqual(companyStyle, requiredStyle, name + " 公司名称不能显示成必填红色");
  assert.doesNotMatch(xml, /<sheetProtection\b/, name + " 模板的表头和数据区都不得设置工作表保护");
  assert.match(xml, /<c r="A2" s="17"/, name + " 数据行须保持可填写");
}
for (const filename of [
  "assets/templates/Warehouse_Stock_Template.xlsx",
  "assets/templates/PI_Whole_Order_Import_Template.xlsx",
  "assets/templates/PI_Import_Template.xlsx",
  "assets/templates/DT-Smart_PI_Template.xlsx",
  "assets/templates/Customer_Public_Pool_Import_Template.xlsx",
  "assets/templates/Customer_Import_Template.xlsx",
  "public/templates/pi-line-import-template.xlsx",
]) {
  const archive = XLSX.CFB.read(await readFile(resolve(filename)), { type: "buffer" });
  for (const [index, part] of archive.FullPaths.entries()) {
    if (!/\/xl\/worksheets\/sheet\d+\.xml$/.test(part)) continue;
    assert.doesNotMatch(archive.FileIndex[index].content.toString("utf8"), /<sheetProtection\b/,
      `${filename} 的 ${part} 不应限制填写或修改`);
  }
}
const customerArchive = XLSX.CFB.read(binary, { type: "buffer" });
const customerStylesPath = customerArchive.FullPaths.findIndex((item) => item.endsWith("/xl/styles.xml"));
assert.ok(customerStylesPath >= 0);
const customerStylesXml = customerArchive.FileIndex[customerStylesPath].content.toString("utf8");
const customerXfs = customerStylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1]
  .match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g);
assert.ok(customerXfs?.[17]?.includes('locked="0"'), "客户导入数据行必须解锁");
assert.match(templateApi, /Customer_Public_Pool_Import_Template/);
assert.match(importView, /api\/import\/template\?destination=\$\{destination\}/);
const archive = XLSX.CFB.read(binary, { type: "buffer" });
const sheetPath = archive.FullPaths.findIndex((item) => item.endsWith("/xl/worksheets/sheet1.xml"));
assert.ok(sheetPath >= 0);
const xml = archive.FileIndex[sheetPath].content.toString("utf8").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
assert.match(xml, /sqref="I2:I1001"[^>]*>.*?潜在客户,意向客户,已成交客户/s);
assert.match(xml, /<dataValidation[^>]*sqref="J2:J1001"[^>]*allowBlank="1"[^>]*>.*?S,KA,MA,A,B,C,D/s, "客户等级下拉必须允许留空并包含七档");

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
for (const [name, source, columns] of [
  ["我的客户", binary, headers],
  ["客户公海", poolBinary, poolHeaders],
]) {
  const filled = XLSX.read(source, { type: "buffer" });
  XLSX.utils.sheet_add_aoa(filled.Sheets["客户导入模板"], [columns.map((header) => sample[header])], { origin: "A11" });
  const uploaded = XLSX.write(filled, { bookType: "xlsx", type: "buffer" });
  const parsed = await parseImportFile(new File([uploaded], `${name}全字段测试.xlsx`));
  assert.equal(parsed.length, 1, `${name}模板填写全列后应准确解析一条记录`);
  for (const header of columns) assert.equal(parsed[0][header], sample[header], `${name}模板字段映射错误：${header}`);
  const actual = sanitizeImportRow(mapImportRow(parsed[0]));
  for (const [field, expected] of Object.entries(safe)) {
    if (name === "客户公海" && ["import_stage", "manual_grade", "import_meta"].includes(field)) continue;
    assert.deepEqual(actual[field], expected, `${name}上传解析后字段错误：${field}`);
  }
}
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
assert.deepEqual(CUSTOMER_GRADE_OPTIONS, ["S", "KA", "MA", "A", "B", "C", "D"]);
for (const grade of CUSTOMER_GRADE_OPTIONS) {
  assert.equal(importedCustomerGrade(grade, "PRIVATE"), grade);
  assert.equal(importedCustomerGrade(grade.toLowerCase(), "PRIVATE"), grade, "导入等级大小写应规范化");
  assert.ok(CUSTOMER_GRADE_DESCRIPTIONS[grade].includes("USD"), "等级说明应明确美元币种");
  assert.equal(customerGradeDescription(grade), CUSTOMER_GRADE_DESCRIPTIONS[grade]);
  assert.equal(isCustomerGrade(grade), true);
}
assert.equal(CUSTOMER_GRADE_DESCRIPTIONS.S, "业绩 ≥ $50,000 USD");
assert.equal(CUSTOMER_GRADE_DESCRIPTIONS.KA, "$30,000 ≤ 业绩 < $50,000 USD");
assert.equal(CUSTOMER_GRADE_DESCRIPTIONS.MA, "$10,000 ≤ 业绩 < $30,000 USD");
assert.equal(CUSTOMER_GRADE_DESCRIPTIONS.A, "$8,000 ≤ 业绩 < $10,000 USD");
assert.equal(CUSTOMER_GRADE_DESCRIPTIONS.B, "$5,000 ≤ 业绩 < $8,000 USD");
assert.equal(CUSTOMER_GRADE_DESCRIPTIONS.C, "$2,000 ≤ 业绩 < $5,000 USD");
assert.equal(CUSTOMER_GRADE_DESCRIPTIONS.D, "业绩 < $2,000 USD");
assert.deepEqual(CUSTOMER_GRADE_OPTIONS.map((grade) => CUSTOMER_GRADE_FILTER_LABELS[grade]), [
  "S   (Sum >= $50000)", "KA   ($30000 <= Sum < $50000)", "MA   ($10000 <= Sum < $30000)",
  "A   ($8000 <= Sum < $10000)", "B   ($5000 <= Sum < $8000)", "C   ($2000 <= Sum < $5000)", "D   (Sum < $2000)",
], "客户等级筛选项须明确显示各档包含下限、不包含上限的英文业绩区间");
assert.match(customersView, /CUSTOMER_GRADE_FILTER_LABELS\[grade\]/, "客户等级筛选显示英文业绩区间且筛选值仍是等级代码");
assert.equal(importedCustomerGrade("", "PRIVATE"), null);
assert.throws(() => importedCustomerGrade("E", "PRIVATE"), /客户等级只能/);
assert.equal(importedCustomerGrade(" ka ", "PRIVATE"), "KA", "前后空格和大小写应规范化");
assert.equal(isCustomerGrade("ka"), false, "类型守卫不能把未经规范化的小写值标为有效等级");
assert.equal(importedCustomerGrade("", "PRIVATE"), null, "客户等级为选填");
assert.throws(() => importedCustomerGrade("KA/MA", "PRIVATE"), /客户等级只能/);
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
assert.match(importView, /customerStageContactError\(item\.import_stage, item\)/, "批量导入预览须显示阶段联系方式错误");
assert.match(importApi, /customerStageContactError\(stage, \{ phone: item\.phone, email: item\.email, wechat: item\.wechat \}\)/, "批量导入API须显式传入联系人渠道字段");
assert.match(workflowApi, /customerStageContactError\(status, customer\.data\)/, "阶段变更API须校验联系方式");
assert.equal(customerStageContactError("FOLLOWING", { wechat: "wx-id" }), null);
assert.equal(customerStageContactError("DEAL", { email: "person@example.com" }), null);
assert.equal(customerStageContactError("已成交客户", { phone: "+1 202 555 0100" }), null);
assert.match(customerStageContactError("FOLLOWING", { wechat: "  ", email: "", phone: "" }) || "", /意向客户.*微信、邮箱或电话/);
assert.equal(customerStageContactError("CLAIMED", {}), null);
assert.doesNotMatch(customerForm, /input\("company_name","公司名称",true\)/, "手动新增公司名称应选填");
assert.doesNotMatch(customerCreateApi, /if \(!body\.company_name\)/, "服务端不得强制公司名称");
assert.match(importApi, /source_stage_label = sourceStageLabel/);
assert.match(importApi, /status: "UNCLAIMED"/);
console.log("客户导入模板表头、下拉选项及结构化地址兼容映射检查通过。");
