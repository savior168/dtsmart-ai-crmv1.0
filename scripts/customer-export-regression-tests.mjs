import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import XLSX from "xlsx";
import { createWorkbookFile } from "../lib/xlsx-export.ts";

const customerExport = await readFile(new URL("../lib/customer-export.ts", import.meta.url), "utf8");
assert.match(customerExport, /name: "AI分析依据"/, "导出必须保留AI依据页");
assert.doesNotMatch(customerExport, /name: "链接与社媒"/, "导出不得再生成链接与社媒子页");
assert.match(customerExport, /original_phone: "原始电话"/, "导出必须将原始电话单列显示");
assert.match(customerExport, /original_email: "原始邮箱号"/, "导出必须将原始邮箱单列显示");
assert.match(customerExport, /ai_phone: "AI采集电话"/, "导出必须将AI采集电话单列显示");
assert.match(customerExport, /ai_email: "AI采集邮箱号"/, "导出必须将AI采集邮箱单列显示");
assert.match(customerExport, /ai_whatsapp: "AI采集WhatsApp"/, "导出必须将AI采集WhatsApp单列显示");
assert.match(customerExport, /facebook: "Facebook"[\s\S]*instagram: "Instagram"[\s\S]*linkedin: "LinkedIn"[\s\S]*tiktok: "TikTok"/, "社媒渠道必须拆分为独立列");
assert.match(customerExport, /customer\.ai_score == null \? "未筛选" : `\$\{exportText\(customer\.ai_level \|\| "-"\)\} · \$\{exportText\(customer\.ai_score\)\}`/, "AI评分必须与前端一样显示等级和评分");
assert.match(customerExport, /externalHyperlinks:[\s\S]*verifiedContactSource[\s\S]*打开该联系方式的来源核验页/, "可定位的AI采集联系方式必须直达来源核验页");
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
console.log("客户导出回归测试通过。");
