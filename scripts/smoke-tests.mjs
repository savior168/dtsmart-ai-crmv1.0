import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const requiredRoutes = [
  "app/page.tsx",
  "app/customers/page.tsx",
  "app/customers/new/page.tsx",
  "app/import/page.tsx",
  "app/ai-screening/page.tsx",
  "app/followups/page.tsx",
  "app/reports/page.tsx",
  "app/settings/page.tsx",
];

for (const route of requiredRoutes) {
  assert.equal(existsSync(resolve(root, route)), true, `缺少页面：${route}`);
}

const customerApi = read("app/api/customers/route.ts");
assert.match(customerApi, /owner_id.*user\.id|created_by.*user\.id/s, "客户查询必须限制为当前用户");
assert.match(customerApi, /ai_score.*null/i, "AI待筛选查询必须包含未评分条件");

const aiApi = read("app/api/ai/analyze/route.ts");
assert.match(aiApi, /ai_screening_done/, "AI完成后必须写入筛选状态");
assert.doesNotMatch(aiApi, /OPENAI_API_KEY[^\n]*(NEXT_PUBLIC|return|json)/i, "服务端密钥不能返回前端");

const analysis = read("lib/ai/customer-analysis.ts");
assert.match(analysis, /"A"\s*\|\s*"B"\s*\|\s*"C"\s*\|\s*"D"/, "AI等级必须仅包含A/B/C/D");
assert.doesNotMatch(analysis, /"S"\s*\|/, "不能保留S级");

const migration = read("supabase/migrations/202608140001_v2_private_crm_compat.sql");
for (const table of [
  "organizations",
  "profiles",
  "customer_contacts",
  "customer_protections",
  "ai_screening_tasks",
  "ai_screening_results",
  "followup_reminders",
  "quotes",
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "i"), `迁移缺少表：${table}`);
}
assert.match(migration, /customers_private_select/i, "迁移缺少客户私有读取策略");

console.log("DTSmart CRM 烟雾测试通过：页面、权限、AI筛选和兼容迁移检查正常。");
