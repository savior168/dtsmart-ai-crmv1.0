import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import XLSX from "xlsx";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("请传入待验证的 xls/xlsx 文件路径");

const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { "@": resolve(".") } });
const runner = await jiti.import(resolve("lib/ai/run-customer-analysis.ts"));
const workbook = XLSX.readFile(inputPath, { raw: false });
const rows = workbook.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: false }));
assert.ok(rows.length > 0, "工作簿没有可验证客户");

const failures = [];
for (const [index, row] of rows.entries()) {
  const name = String(row["名称"] || row["商店名称"] || "").trim();
  const address = String(row["商店地址"] || "").trim();
  const phone = String(row["完整号码"] || "").trim();
  const googleUrl = String(row["谷歌网址"] || "").trim();
  const categories = `${row["分类"] || ""}\n${row["商店类型"] || ""}`.split(/[\/\n]/).map((value) => value.trim()).filter(Boolean);
  const ratingParts = String(row["商店分数/评论数"] || "").split("/");
  const customer = { id: String(row.ID || index + 1), company_name: name, country: String(row["国家"] || ""), phone, email: String(row["邮箱"] || ""), website: String(row["商家官网网址"] || ""), google_url: googleUrl, address };
  const records = [{ channel: "google_maps", status: "COLLECTED", source_url: googleUrl, evidence: { name, formatted_address: address, phone, types: categories, rating: Number(ratingParts[0] || 0), user_ratings_total: Number(ratingParts[1] || 0), reviews: [], identity_status: "MATCHED", identity_confidence: 100, match_signals: ["商家名称高度一致", "地址信息一致", "电话号码一致"], mismatch_signals: [], verified_google_maps_url: googleUrl } }];
  const result = runner.deterministicAnalysis(customer, records);
  if (!result || result.ai_score == null || result.ai_level == null || !result.is_target_customer) failures.push({ row: index + 2, name, categories, result: result ? { score: result.ai_score, level: result.ai_level, industry: result.industry_type, target: result.is_target_customer } : null });
}

assert.deepEqual(failures, [], `以下样本未形成有效目标评分：${JSON.stringify(failures, null, 2)}`);
console.log(`真实导入样本验证通过：${rows.length}/${rows.length} 条均形成有效目标评分。`);
