import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import XLSX from "xlsx";
import { createWorkbookFile } from "../lib/xlsx-export.ts";

const customerExport = await readFile(new URL("../lib/customer-export.ts", import.meta.url), "utf8");
assert.match(customerExport, /name: "AI分析依据"/, "导出必须保留AI依据页");
assert.doesNotMatch(customerExport, /name: "链接与社媒"/, "导出不得再生成链接与社媒子页");
assert.match(customerExport, /"电话（复制）"/, "必须提供电话批量复制列");
assert.match(customerExport, /"WhatsApp（复制）"/, "必须提供WhatsApp批量复制列");
assert.match(customerExport, /"邮箱（复制）"/, "必须提供邮箱批量复制列");
assert.match(customerExport, /if \(key === "ai_score"\) return customer\.ai_score == null \? "未分析" : exportText\(customer\.ai_score\)/, "AI评分必须只导出数值，不得混入AI等级");
assert.match(customerExport, /key !== "last_contact_time" && \(options\.includeOwner !== false \|\| key !== "owner"\)/, "导出必须排除最近联系时间，并让客户公海排除归属人");
assert.match(customerExport, /target: `#'AI分析依据'!A\$\{evidenceRow\}`/, "AI依据必须跳转到对应客户的依据行");

const sheets = [
  {
    name: "客户清单",
    rows: [["客户名称", "AI评分", "AI依据", "电话（复制）", "WhatsApp（复制）", "邮箱（复制）"], ["示例客户 A", "76", "查看依据", "+48 123 456 789", "+48 987 654 321", "service@example.com"]],
    internalHyperlinks: [{ row: 1, column: 2, target: "#'AI分析依据'!A2" }],
  },
  { name: "AI分析依据", rows: [["客户名称", "分析依据摘要"], ["示例客户 A", "官网服务页明确提供手机维修。"]] },
];

const workbook = XLSX.read(createWorkbookFile(sheets), { type: "buffer", cellStyles: true });
assert.deepEqual(workbook.SheetNames, ["客户清单", "AI分析依据"], "工作簿只保留主表与AI依据页");
assert.equal(workbook.Sheets["客户清单"].C2.l?.Target, "#'AI分析依据'!A2", "Excel内部跳转必须写入指定依据行");
assert.equal(workbook.Sheets["AI分析依据"].A2.v, "示例客户 A", "依据页客户行必须与跳转目标对应");
console.log("客户导出回归测试通过。");
