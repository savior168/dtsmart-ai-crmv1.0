import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const taskCreateRoute = read("app/api/ai-acquisition/tasks/route.ts");
assert.match(taskCreateRoute, /industryInputs\.some\(\(value\) => !validIndustry\(value\)\)[\s\S]*目标行业须为2至60个字符/, "无效目标行业必须明确报错，不能静默丢弃");
assert.match(taskCreateRoute, /body\.countries\.some\(\(value\) => !normalizeAcquisitionCountries\(\[value\]\)\.length\)[\s\S]*目标国家包含不受支持的选项/, "不支持的国家必须明确报错，不能静默忽略");
assert.match(taskCreateRoute, /keywordInputs\.some\(\(value\) => value\.length > 80\)[\s\S]*系统不会静默丢弃关键词/, "超长关键词必须明确报错，不能静默丢弃");
assert.match(taskCreateRoute, /body\.cost_mode != null && !\["FREE_ONLY", "ADAPTIVE"\]\.includes\(String\(body\.cost_mode\)\)[\s\S]*获客模式无效/, "未知获客模式不得被静默转换为可能付费的智能获客");

for (const path of ["app/ai-acquisition/layout.tsx", "app/ai-acquisition/page.tsx", "supabase/migrations/202609150002_ai_acquisition_permissions.sql", "supabase/migrations/202609150003_ai_acquisition_admin_default.sql", "supabase/migrations/202609170003_ai_modules_admin_default.sql"]) {
  assert.equal(existsSync(resolve(root, path)), true, `缺少AI获客权限文件：${path}`);
}

const permissions = read("lib/auth/permissions.ts");
for (const code of [
  "ai.acquisition.view", "ai.acquisition.data_all", "ai.acquisition.create", "ai.acquisition.control",
  "ai.acquisition.evidence.view", "ai.acquisition.usage.view", "ai.acquisition.settings.manage",
]) assert.match(permissions, new RegExp(`code: "${code.replaceAll(".", "\\.")}"`), `权限目录缺少 ${code}`);
assert.match(permissions, /if \(code\.startsWith\("ai\.acquisition\."\)\) return "ai\.acquisition\.view"/, "AI获客子权限必须归属AI获客页面");

const layout = read("app/ai-acquisition/layout.tsx");
assert.match(layout, /protectPage\("ai\.acquisition\.view"\)/, "AI获客页面必须服务端校验访问权限");

const migration = read("supabase/migrations/202609150002_ai_acquisition_permissions.sql");
const defaultLock = read("supabase/migrations/202609150003_ai_acquisition_admin_default.sql");
const unifiedDefaultLock = read("supabase/migrations/202609170003_ai_modules_admin_default.sql");
assert.match(defaultLock, /\('SUPERVISOR'\), \('SALES'\), \('WAREHOUSE'\)/, "非管理员角色必须进入AI获客默认锁定矩阵");
assert.match(defaultLock, /select role_code, permission_code, false/, "AI获客默认权限写入必须关闭");
assert.match(defaultLock, /\('ai\.acquisition\.view'\)[\s\S]*\('ai\.acquisition\.create'\)/, "AI获客菜单与创建动作必须包含在默认锁定矩阵");
assert.doesNotMatch(defaultLock, /\('SALES','ai\.acquisition\.data_all',true\)/, "销售员不得被授予跨用户获客数据权限");
assert.match(unifiedDefaultLock, /\('ai\.acquisition\.view'\)[\s\S]*\('ai\.tasks\.view'\)/, "AI获客和AI筛选菜单都必须进入默认锁定矩阵");
assert.match(unifiedDefaultLock, /select role_code, permission_code, false/, "非管理员AI模块默认权限必须关闭");

console.log("AI acquisition permission regression tests passed.");
