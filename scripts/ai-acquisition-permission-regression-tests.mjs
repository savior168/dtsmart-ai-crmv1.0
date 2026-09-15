import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

for (const path of ["app/ai-acquisition/layout.tsx", "app/ai-acquisition/page.tsx", "supabase/migrations/202609150002_ai_acquisition_permissions.sql"]) {
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
assert.match(migration, /\('SUPERVISOR','ai\.acquisition\.data_all',true\)/, "主管必须具有获客跨用户数据权限默认项");
assert.match(migration, /\('SALES','ai\.acquisition\.create',true\)/, "销售员必须具有创建本人获客任务默认项");
assert.doesNotMatch(migration, /\('SALES','ai\.acquisition\.data_all',true\)/, "销售员不得被授予跨用户获客数据权限");

console.log("AI acquisition permission regression tests passed.");
