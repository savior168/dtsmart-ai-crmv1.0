import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { countryInfo } from "../lib/countries.ts";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/202609300003_sales_report_current_owner_metrics.sql");
const countryMigration = read("supabase/migrations/202609300004_sales_report_all_country_groups.sql");
const dashboardCountryMigration = read("supabase/migrations/202609300005_dashboard_country_groups_before_top10.sql");
const dashboardApi = read("app/api/dashboard/stats/route.ts");
const dashboard = read("components/crm-dashboard.tsx");
const reports = read("components/sales-reports-view.tsx");
const reportLoader = read("lib/reports/sales.ts");

assert.match(migration, /left join public\.customers c on c\.owner_id=s\.id and c\.deleted_at is null/, "销售客户指标只能统计当前归属且在库的客户");
assert.match(migration, /count\(c\.id\) filter\(where c\.created_at>=p_from and c\.created_at<p_to\) as new_customers/, "期间新增必须与报表日期范围一致");
assert.match(migration, /c\.ai_screening_done is true and c\.is_target_customer is true/, "有效目标不能仅按高分推断");
assert.match(migration, /c\.owner_id is not null and \(scope_id is null or c\.owner_id=scope_id\)/, "报表分布和趋势不得混入公海未认领客户");
assert.match(migration, /count\(distinct a\.target_id\).*status'='DEAL'/, "同一客户的重复成交阶段事件不能重复计数");
assert.match(migration, /a\.role='SUPERVISOR' and \(u\.id=a\.id or u\.manager_id=a\.id\)/, "主管业绩报表必须覆盖本人和直属销售员");
assert.match(migration, /u\.id=p_user_id and u\.manager_id=actor\.id and u\.status='ACTIVE'/, "主管直接调用报表RPC不得跨组查看数据");
assert.match(dashboardApi, /account\.role === "ADMIN" \? supabase\.from\("customers"\).*\.is\("deleted_at", null\)/, "全系统在库总数必须仅供管理员且排除删除客户");
assert.match(dashboardApi, /\.or\("pool_status\.is\.null,pool_status\.neq\.AI_STAGING"\)/, "全系统在库总数不能包含未入池的 AI 暂存记录");
assert.match(dashboardApi, /normalizeReportCountries\(\(\(overview\.country_top \|\| \[\]\) as CountRow\[\]\)/, "工作台国家必须先合并别名再取 TOP10");
assert.match(dashboardCountryMigration, /previous_grouping text := 'from filtered_customers group by 1 order by count desc,name limit 10'/, "工作台数据库函数不得提前截断原始国家分组");
assert.doesNotMatch(dashboardApi, /statusCount\("UNCLAIMED"\)/, "销售漏斗不得展示不属于销售阶段的新客户");
assert.match(dashboard, /canCreateAcquisition \? <Link href="\/ai-acquisition\/new"/, "AI获客快捷入口必须按创建权限显示");
assert.match(reports, /期间新增在库/, "报表新增指标必须明确当前在库口径");
assert.match(reports, /end\.setUTCDate\(end\.getUTCDate\(\) \+ 1\)/, "报表查询日期上界必须覆盖所选结束日");
assert.match(countryMigration, /country_rows as \([\s\S]*?group by 1\s*\)/, "国家分组必须先返回全部原始值，不能在标准化前截断 TOP10");
assert.match(reportLoader, /normalizeReportCountries\(countRows\(raw\.countries\)\)/, "国家必须标准化合并后再选 TOP10");
assert.match(reports, /customerDetailHref\(scope, \{ country: row\.label \}\)/, "国家明细应只传规范国家值，由客户接口匹配历史别名");
assert.match(reports, /user_id: scope === "ALL" \? "all" : scope/, "报表全员明细必须使用客户列表的全员筛选值");
assert.doesNotMatch(reports, /report\.scope === "ALL" \? undefined : customerDetailHref/, "切换全部归属人后客户指标仍需可进入同范围明细");
assert.match(reports, /customerDetailHref\(scope, \{ status: row\.label \}\)/, "客户阶段需跳转同口径明细");
assert.doesNotMatch(reports, /function BusinessMotion/, "报表不得重复展示相同业务指标");

const compiledReport = ts.transpileModule(reportLoader, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const reportExports = {};
runInNewContext(compiledReport, { exports: reportExports, require: (name) => {
  if (name === "@/lib/countries") return { countryInfo };
  throw new Error(`unexpected import: ${name}`);
} });
const mergedCountries = reportExports.normalizeReportCountries([
  { label: "IE", count: 1 }, { label: "爱尔兰", count: 1 }, { label: "GB", count: 1 }, { label: "ES", count: 1 },
]);
assert.equal(mergedCountries.length, 3, "同一国家的代码与中文名称只能出现一次");
assert.equal(mergedCountries[0].label, "IE");
assert.equal(mergedCountries[0].count, 2);
assert.deepEqual([...mergedCountries[0].source_labels], ["IE", "爱尔兰"], "跳转明细需包含两种原始国家值");

console.log("报表与工作台口径回归检查通过");
