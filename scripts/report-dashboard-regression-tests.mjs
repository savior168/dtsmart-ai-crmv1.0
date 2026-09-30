import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/202609300003_sales_report_current_owner_metrics.sql");
const dashboardApi = read("app/api/dashboard/stats/route.ts");
const dashboard = read("components/crm-dashboard.tsx");
const reports = read("components/sales-reports-view.tsx");

assert.match(migration, /left join public\.customers c on c\.owner_id=s\.id and c\.deleted_at is null/, "销售客户指标只能统计当前归属且在库的客户");
assert.match(migration, /count\(c\.id\) filter\(where c\.created_at>=p_from and c\.created_at<p_to\) as new_customers/, "期间新增必须与报表日期范围一致");
assert.match(migration, /c\.ai_screening_done is true and c\.is_target_customer is true/, "有效目标不能仅按高分推断");
assert.match(migration, /c\.owner_id is not null and \(scope_id is null or c\.owner_id=scope_id\)/, "报表分布和趋势不得混入公海未认领客户");
assert.match(migration, /count\(distinct a\.target_id\).*status'='DEAL'/, "同一客户的重复成交阶段事件不能重复计数");
assert.match(migration, /a\.role='SUPERVISOR' and \(u\.id=a\.id or u\.manager_id=a\.id\)/, "主管业绩报表必须覆盖本人和直属销售员");
assert.match(migration, /u\.id=p_user_id and u\.manager_id=actor\.id and u\.status='ACTIVE'/, "主管直接调用报表RPC不得跨组查看数据");
assert.match(dashboardApi, /account\.role === "ADMIN" \? supabase\.from\("customers"\).*\.is\("deleted_at", null\)/, "全系统在库总数必须仅供管理员且排除删除客户");
assert.doesNotMatch(dashboardApi, /statusCount\("UNCLAIMED"\)/, "销售漏斗不得展示不属于销售阶段的新客户");
assert.match(dashboard, /canCreateAcquisition \? <Link href="\/ai-acquisition\/new"/, "AI获客快捷入口必须按创建权限显示");
assert.match(reports, /期间新增在库/, "报表新增指标必须明确当前在库口径");
assert.match(reports, /end\.setUTCDate\(end\.getUTCDate\(\) \+ 1\)/, "报表查询日期上界必须覆盖所选结束日");

console.log("报表与工作台口径回归检查通过");
