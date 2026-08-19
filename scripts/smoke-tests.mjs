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
assert.doesNotMatch(customerApi, /query\s*=\s*query\.or\(`owner_id\.eq\.\$\{user\.id\},created_by\.eq\.\$\{user\.id\}`\)/, "客户查询必须由 Supabase RLS 统一控制，不能按创建人再次收窄");
assert.match(customerApi, /ai_score.*null/i, "AI待筛选查询必须包含未评分条件");
assert.match(customerApi, /customer_conflicts/, "手动新增的跨用户重复客户必须进入冲突队列");
assert.match(customerApi, /CROSS_OWNER_DUPLICATE/, "冲突记录必须使用跨归属人重复标记");

const aiApi = read("app/api/ai/analyze/route.ts");
assert.match(aiApi, /ai_screening_done/, "AI完成后必须写入筛选状态");
assert.doesNotMatch(aiApi, /OPENAI_API_KEY[^\n]*(NEXT_PUBLIC|return|json)/i, "服务端密钥不能返回前端");

const analysis = read("lib/ai/customer-analysis.ts");
assert.match(analysis, /"A"\s*\|\s*"B"\s*\|\s*"C"\s*\|\s*"D"/, "AI等级必须仅包含A/B/C/D");
assert.doesNotMatch(analysis, /"S"\s*\|/, "不能保留S级");

const importView = read("components/import-view.tsx");
assert.match(importView, /async function isReadableImportFile/, "文件夹导入必须验证真实文件内容");
assert.match(importView, /file\.size <= 0/, "文件夹导入必须过滤空文件");
assert.match(importView, /const displayFailure = stats \?[^\n]+: 0;/, "确认导入前失败数必须为0");
assert.match(importView, /const displayFailure = stats \? stats\.failed_count : 0;/, "失败导入不能重复叠加校验错误数");
assert.match(importView, /const displayConflict = stats\?\.conflict_count \?\? 0;/, "确认导入前冲突数必须为0");
assert.match(importView, /if \(!importSessionSnapshot\.rows\.length\)[\s\S]*removeItem\(LAST_IMPORT_RESULT_KEY\)/, "没有匹配明细时必须清除陈旧导入统计");
assert.match(importView, /onClick=\{\(\) => void confirmImport\(\)\}/, "正式导入必须由确认按钮触发");
const taskRuntime = read("components/task-runtime.tsx");
assert.match(taskRuntime, /requestPath === "\/api\/import"/, "任务提示只能监听正式导入接口");
assert.doesNotMatch(taskRuntime, /requestUrl\.includes\("\/api\/import"\).*isImport/, "不能把导入预览误判为正式导入");
assert.match(importView, /href="\/customers\?tab=conflicts"/, "导入结果的冲突客户卡片必须切换到客户管理冲突页签");
assert.match(importView, /成功导入[\s\S]*失败导入[\s\S]*重复数据[\s\S]*冲突客户/, "完整导入报告必须包含四类结果页签");
assert.match(importView, /当前归属人/, "导入明细和冲突报告必须显示当前归属人");
const importApi = read("app/api/import/route.ts");
assert.match(importApi, /for \(let from = 0; ; from \+= 1000\)/, "导入去重必须分页读取全部现有客户，不能设置固定上限");
assert.match(importApi, /error\?\.code === "23505"/, "导入必须处理数据库并发唯一冲突");
assert.match(importApi, /客户已存在于我的客户列表，保留最先导入的数据/, "本人已有客户必须计入导入失败并保留最早记录");
assert.match(importApi, /status: "conflict", reason: "客户已归属其他销售员"/, "其他归属人的重复客户必须计入冲突客户");
assert.match(importApi, /owner_name:/, "冲突导入结果必须返回当前归属人");
const conflictApi = read("app/api/customer-conflicts/route.ts");
assert.match(conflictApi, /withOwner/, "冲突列表必须返回当前归属人信息");
assert.match(conflictApi, /\.eq\("reported_by", user\.id\)/, "冲突列表必须显式限定为当前用户提交的数据");
assert.match(conflictApi, /dedupeConflicts/, "冲突客户汇总必须去重");
const permanentDelete = read("lib/customers/soft-delete.ts");
assert.match(permanentDelete, /offset \+= 200/, "批量永久删除必须分批处理，避免大批量ID被截断");
assert.match(permanentDelete, /customer\.owner_id === userId/, "销售只能永久删除当前归属自己的客户");
assert.match(permanentDelete, /\.from\("customers"\)[\s\S]*?\.delete\(\)/, "客户删除必须从数据库物理删除");
assert.match(permanentDelete, /\["QUOTE", "DEAL"\]/, "报价中和成交客户必须禁止删除");

const appShell = read("components/app-shell.tsx");
assert.match(appShell, /sticky top-0[^\n]*h-screen/, "桌面左侧菜单必须固定在浏览器视口内");
assert.match(appShell, /h-\[calc\(100vh-196px\)\][^\n]*overflow-y-auto/, "菜单项必须独立滚动且不能推走底部控制项");
const customersView = read("components/customers-view.tsx");
assert.doesNotMatch(customersView, />\s*跟进待办/, "客户管理页签不得保留跟进待办");
assert.match(customersView, /CustomerProtectionPanel/, "保护到期必须在客户管理同页切换");
assert.match(customersView, /CustomerConflictsPanel/, "冲突客户必须在客户管理同页切换");
const dashboard = read("components/crm-dashboard.tsx");
assert.match(dashboard, /const protectionPageSize = 4/, "保护到期提醒必须限制单页数量");
assert.match(dashboard, /visibleProtections\.map/, "保护到期提醒必须只渲染当前页数据");

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
