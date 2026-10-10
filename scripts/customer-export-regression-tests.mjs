import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import XLSX from "xlsx";
import { createWorkbookFile } from "../lib/xlsx-export.ts";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { buildCustomerWorkbookSheets } = await jiti.import("../lib/customer-export.ts");
const { exportOfficialWebsiteText, exportPublicChannelForUrl, legacyWebsiteExportPatch } = await jiti.import("../lib/customers/export-public-channels.ts");
const customerExport = await readFile(new URL("../lib/customer-export.ts", import.meta.url), "utf8");
assert.match(customerExport, /name: "AI分析依据"/, "导出必须保留AI依据页");
assert.match(customerExport, /"company_name", "ai_score", "industry", "country"/, "默认导出必须在AI评分后显示所属行业");
assert.match(customerExport, /source_batch: "来源批次"/, "导出必须包含可追溯的来源批次");
assert.doesNotMatch(customerExport, /name: "链接与社媒"/, "导出不得再生成链接与社媒子页");
assert.match(customerExport, /phone: "电话号码", whatsapp: "WhatsApp", email: "邮箱"/, "联系方式导出列头须与客户页一致");
assert.doesNotMatch(customerExport, /original_phone:|ai_phone:|ai_email:|ai_whatsapp:/, "原始与AI联系方式不得重复出列");
assert.match(customerExport, /facebook: "Facebook"[\s\S]*instagram: "Instagram"[\s\S]*linkedin: "LinkedIn"[\s\S]*tiktok: "TikTok"/, "社媒渠道必须拆分为独立列");
assert.match(customerExport, /customer\.ai_score == null \? "未筛选" : `\$\{exportText\(customer\.ai_level \|\| "-"\)\} · \$\{exportText\(customer\.ai_score\)\}`/, "AI评分必须与前端一样显示等级和评分");
assert.match(customerExport, /externalHyperlinks:[\s\S]*verifiedContactSource[\s\S]*打开该联系方式的来源核验页/, "只有单一精确来源的联系方式才可直达核验页");
assert.match(customerExport, /key !== "last_contact_time" && \(options\.includeOwner !== false \|\| key !== "owner"\)/, "导出必须排除最近联系时间，并让客户公海排除归属人");
assert.match(customerExport, /target: `#'AI分析依据'!A\$\{evidenceRow\}`/, "AI依据必须跳转到对应客户的依据行");

const sheets = [
  {
    name: "客户清单",
    rows: [["客户名称", "AI评分", "AI依据", "原始电话", "原始邮箱号", "AI采集电话", "AI采集邮箱号", "AI采集WhatsApp", "Facebook"], ["示例客户 A", "B · 76", "查看依据", "+48 123 456 789", "original@example.com", "+48 987 654 321", "service@example.com", "+48 555 111 222", "https://facebook.com/example"]],
    internalHyperlinks: [{ row: 1, column: 2, target: "#'AI分析依据'!A2" }],
    externalHyperlinks: [{ row: 1, column: 5, target: "https://example.com/contact" }],
  },
  { name: "AI分析依据", rows: [["客户名称", "分析依据摘要"], ["示例客户 A", "官网服务页明确提供手机维修。"]] },
];

const workbook = XLSX.read(createWorkbookFile(sheets), { type: "buffer", cellStyles: true });
assert.deepEqual(workbook.SheetNames, ["客户清单", "AI分析依据"], "工作簿只保留主表与AI依据页");
assert.equal(workbook.Sheets["客户清单"].C2.l?.Target, "#'AI分析依据'!A2", "Excel内部跳转必须写入指定依据行");
assert.equal(workbook.Sheets["AI分析依据"].A2.v, "示例客户 A", "依据页客户行必须与跳转目标对应");
assert.equal(workbook.Sheets["客户清单"].F2.l?.Target, "https://example.com/contact", "AI采集联系方式必须能直达具体来源页");

const customer = {
  id: "customer-1", company_name: "示例客户", country: "GB",
  phone: "+44 44 7700 900123", whatsapp: "+44 7700 900456",
  email: "hello@example.com", website: "https://example.com",
  google_url: "https://maps.google.com/?cid=123",
  facebook_url: "https://facebook.com/example",
  instagram_url: "https://instagram.com/example",
  linkedin_url: "https://linkedin.com/company/example",
  tiktok_url: "https://tiktok.com/@example",
  other_public_urls: ["https://youtube.com/@example", "https://x.com/example", "https://wa.me/447700900456", "https://example.net/company"],
  website_phone: "+44 20 1234 5678",
  verified_contacts: [
    { type: "PHONE", value_raw: "+44 30 1234 5678", verification_status: "NEW_VERIFIED", exact_source_url: "https://example.com/contact" },
    { type: "EMAIL", value_raw: "sales@example.com", verification_status: "NEW_VERIFIED", exact_source_url: "https://example.com/contact" },
    { type: "WHATSAPP", value_raw: "+44 7700 900999", verification_status: "NEW_VERIFIED", exact_source_url: "https://example.com/contact" },
  ],
};
const evidenceCustomer = { ...customer, ai_reason: "内部分析依据", company_scale_evidence: "内部规模来源" };
const salesSheets = buildCustomerWorkbookSheets([evidenceCustomer], { columns: ["company_name", "ai_score"] });
assert.deepEqual(salesSheets.map((sheet) => sheet.name), ["客户清单"], "普通角色导出不得附带完整AI依据页");
assert.equal(salesSheets[0].rows[0].includes("AI依据"), false, "普通角色导出不得显示AI依据入口");
assert.equal(salesSheets[0].internalHyperlinks?.length, 0, "普通角色导出不得生成AI依据跳转");
const adminSheets = buildCustomerWorkbookSheets([evidenceCustomer], { columns: ["company_name", "ai_score"], includeAiEvidence: true });
assert.deepEqual(adminSheets.map((sheet) => sheet.name), ["客户清单", "AI分析依据"], "管理员导出仍应包含完整AI依据页");
assert.equal(adminSheets[1].rows[1][8], "内部规模来源", "管理员依据页应保留规模来源");
const exportedSheets = buildCustomerWorkbookSheets([customer], {
  columns: ["company_name", "email", "website_phone"],
  includeAllContactChannels: true,
});
const exportedHeaders = exportedSheets[0].rows[0];
const exportedWorkbook = XLSX.read(createWorkbookFile(exportedSheets), { type: "buffer", cellStyles: true });
const exportedSheet = exportedWorkbook.Sheets["客户清单"];
const cell = (label) => {
  const column = exportedHeaders.indexOf(label);
  assert.notEqual(column, -1, `缺少导出列：${label}`);
  return exportedSheet[XLSX.utils.encode_cell({ r: 1, c: column })];
};
assert.equal(exportedHeaders.filter((header) => header === "邮箱").length, 1, "邮箱不得重复或被电话列替代");
assert.equal(exportedHeaders.filter((header) => header === "电话号码").length, 1, "电话原始值与AI采集值应合并为一列");
assert.equal(exportedHeaders.filter((header) => header === "WhatsApp").length, 1, "WhatsApp原始值与AI采集值应合并为一列");
assert.equal(exportedHeaders.some((header) => header.startsWith("AI采集")), false, "不得再出现重复的AI采集联系方式列");
assert.match(cell("电话号码").v, /\+44 44 7700 900123[\s\S]*\+44 30 1234 5678/, "电话号码必须保留原始及AI核验号码");
assert.match(cell("WhatsApp").v, /\+44 7700 900456[\s\S]*\+44 7700 900999/, "WhatsApp必须保留原始及AI核验号码");
assert.match(cell("邮箱").v, /hello@example.com[\s\S]*sales@example.com/, "邮箱必须保留原始及AI核验地址");
assert.equal(cell("官网电话").v, customer.website_phone, "明确选择的官网电话不得被静默丢弃");
assert.equal(cell("邮箱").l, undefined, "混合原始及AI邮箱不得错误链接到单一核验来源");
const aiOnlySheet = buildCustomerWorkbookSheets([{ ...customer, phone: null, whatsapp: null, email: null, website_phone: null }], {
  columns: ["company_name"], includeAllContactChannels: true,
})[0];
const aiOnlyWorkbook = XLSX.read(createWorkbookFile([aiOnlySheet]), { type: "buffer", cellStyles: true });
const aiOnlyEmailColumn = aiOnlySheet.rows[0].indexOf("邮箱");
assert.notEqual(aiOnlyEmailColumn, -1, "仅有AI核验邮箱时仍须导出邮箱列");
assert.equal(aiOnlyWorkbook.Sheets["客户清单"][XLSX.utils.encode_cell({ r: 1, c: aiOnlyEmailColumn })].l?.Target, "https://example.com/contact", "仅有同一精确来源的邮箱应保留核验链接");
for (const [label, target] of [
  ["官网", customer.website], ["Google Maps", customer.google_url],
  ["Facebook", customer.facebook_url], ["Instagram", customer.instagram_url],
  ["LinkedIn", customer.linkedin_url], ["TikTok", customer.tiktok_url],
  ["YouTube", customer.other_public_urls[0]], ["X（Twitter）", customer.other_public_urls[1]],
  ["WhatsApp公开链接", customer.other_public_urls[2]], ["其他公开链接 1", customer.other_public_urls[3]],
]) {
  assert.equal(cell(label).v, target, `${label}必须保留完整网址`);
  assert.equal(cell(label).l?.Target, target, `${label}必须准确跳转到该渠道`);
}
assert.equal(exportedHeaders.filter((header) => header.startsWith("其他公开链接")).length, 1, "已识别的平台链接不得重复堆进其他公开链接列");
const sparseSheet = buildCustomerWorkbookSheets([{ id: "sparse", company_name: "无联系方式客户", status: "DEAL" }], {
  columns: ["company_name", "status"], includeAllContactChannels: true,
})[0];
assert.deepEqual(sparseSheet.rows[0], ["客户名称", "客户阶段"], "整批无数据的联系方式与渠道列不应导出");
assert.equal(sparseSheet.rows[1][1], "成交客户", "客户阶段名称须与我的客户页面一致");
const domainOnlySheets = buildCustomerWorkbookSheets([
  { id: "domain-only", company_name: "仅域名客户", website: "example.org/contact", facebook_url: "javascript:alert(1)", other_public_urls: ["https://youtube.com/@main", "https://youtube.com/@support"] },
], { columns: ["company_name"], includeAllContactChannels: true });
const domainOnlyWorkbook = XLSX.read(createWorkbookFile(domainOnlySheets), { type: "buffer", cellStyles: true });
const domainHeaders = domainOnlySheets[0].rows[0];
const domainSheet = domainOnlyWorkbook.Sheets["客户清单"];
const domainCell = (label) => domainSheet[XLSX.utils.encode_cell({ r: 1, c: domainHeaders.indexOf(label) })];
assert.equal(domainCell("官网").v, "example.org/contact", "不得改写客户保存的原始官网文字");
assert.equal(domainCell("官网").l?.Target, "https://example.org/contact", "仅域名官网也应可点击");
assert.equal(domainCell("Facebook").l, undefined, "非HTTP(S)渠道不得生成可执行链接");
assert.equal(domainCell("YouTube").v, "https://youtube.com/@main\nhttps://youtube.com/@support", "同平台多个主页须在其平台列完整保留");
assert.equal(domainCell("YouTube").l, undefined, "单元格存在多个网址时不得误链到拼接后的地址");

for (const [raw, label] of [
  ["https://youtube.com/@legacy", "YouTube"],
  ["x.com/legacy", "X（Twitter）"],
  ["https://wa.me/447700900456", "WhatsApp公开链接"],
  ["https://maps.google.com/?cid=123", "Google Maps"],
  ["facebook.com/legacy", "Facebook"],
]) {
  const original = { id: raw, company_name: "历史渠道客户", website: raw };
  const normalized = { ...original, website: exportOfficialWebsiteText(raw), ...legacyWebsiteExportPatch(original, raw) };
  const legacySheet = buildCustomerWorkbookSheets([normalized], { columns: ["company_name"], includeAllContactChannels: true })[0];
  assert.equal(normalized.website, null, `${label}不得伪装为企业官网`);
  assert.equal(legacySheet.rows[1][legacySheet.rows[0].indexOf(label)], raw, `历史官网字段中的${label}必须归入平台列`);
}
assert.equal(exportPublicChannelForUrl("https://maps.google.com/?cid=123"), "google_maps", "旧版 CID 地图链接必须识别为 Google Maps");
assert.equal(exportOfficialWebsiteText("example.org/contact"), "example.org/contact", "旧版不带协议的真实官网文字必须保留");
assert.equal(exportOfficialWebsiteText("javascript:alert(1)"), null, "不安全协议不得导出为官网");
assert.equal(exportPublicChannelForUrl("https://maps.google.com.evil.example/?cid=123"), null, "伪造 Google Maps 域名不得归类为地图");
const preservedLegacy = legacyWebsiteExportPatch({
  facebook_url: "https://facebook.com/new",
  other_public_urls: ["https://youtube.com/@previous"],
}, "https://facebook.com/old");
assert.deepEqual(preservedLegacy.other_public_urls, ["https://youtube.com/@previous", "https://facebook.com/old"], "已有平台主页时历史链接仍需保留，不得覆盖新链接");

const customersApi = await readFile(new URL("../app/api/customers/route.ts", import.meta.url), "utf8");
assert.match(customersApi, /requirePermission\(exportMode \? "customers.export" : "customers.view"\)/, "下载完整客户资料须校验导出权限");
assert.match(customersApi, /exportMode \? exportOfficialWebsiteText\(rawWebsite\) : officialWebsiteUrl\(rawWebsite\)/, "仅导出时兼容裸域名官网，不改普通列表语义");
assert.match(customersApi, /exportMode \? legacyWebsiteExportPatch\(normalized, rawWebsite\) : \{\}/, "历史公开平台网址仅在导出路径补齐");
assert.match(customersApi, /account\.role !== "ADMIN"[\s\S]*company_scale_evidence: null/, "普通角色的客户接口不得返回原始规模依据");
const customersView = await readFile(new URL("../components/customers-view.tsx", import.meta.url), "utf8");
assert.match(customersView, /includeAllContactChannels: true/, "我的客户导出必须固定包含全部联系方式与公开渠道");
assert.match(customersView, /includeAiEvidence: currentRole === "ADMIN"/, "完整AI依据导出仅限管理员");
console.log("客户导出回归测试通过。");
