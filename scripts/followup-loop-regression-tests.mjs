import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localDateTimeInput, quickLocalDateTime } from "../lib/date-time.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/202609300001_customer_followup_queue.sql");
const api = read("app/api/followups/route.ts");
const exportApi = read("app/api/followups/export/route.ts");
const dashboard = read("app/api/dashboard/stats/route.ts");
const view = read("components/followups-view.tsx");
const detail = read("components/customer-crm-detail-view.tsx");
const correction = read("app/api/followups/[id]/route.ts");

assert.match(migration, /customer_followup_queue[\s\S]*security_invoker = true[\s\S]*left join lateral[\s\S]*order by f\.created_at desc, f\.id desc[\s\S]*limit 1/, "待办必须基于每个客户最新一条跟进，且遵循 RLS");
assert.match(migration, /customer_followup_history[\s\S]*security_invoker = true/, "历史视图不得绕过行权限");
assert.match(api, /scope === "unscheduled"[\s\S]*\.is\("next_follow_date", null\)/, "无计划日期的已归属客户必须进入待安排");
assert.match(api, /scope === "upcoming"[\s\S]*\.gte\("next_follow_date", end\)/, "后续计划不得混入今日待办");
assert.match(api, /scope === "today"[\s\S]*\.gte\("next_follow_date", start\)\.lt\("next_follow_date", end\)/, "今日口径必须采用同一业务日边界");
assert.match(exportApi, /customer_followup_queue[\s\S]*scope === "unscheduled"/, "导出与列表必须使用同一有效计划口径");
assert.match(dashboard, /followupDayBounds\(now\)[\s\S]*customer_followup_queue/, "工作台今日待办必须与跟进管理一致");
assert.match(view, /待安排[\s\S]*action=followup&from=followups/, "未安排客户应可直接进入跟进录入");
assert.match(detail, /new Date\(draft\.next_follow_date\)\.toISOString\(\)/, "浏览器本地时间保存前必须转换为带时区时间");
assert.match(correction, /editReason\.length < 5[\s\S]*correct_customer_followup/, "历史更正必须提交原因并调用原子事务");
assert.match(migration, /correct_customer_followup[\s\S]*for update[\s\S]*'before'[\s\S]*'after'/, "历史更正事务必须锁定归属并保留前后审计");

const timestamp = "2026-09-30T02:00:00.000Z";
assert.equal(new Date(localDateTimeInput(timestamp)).toISOString(), timestamp);
assert.match(quickLocalDateTime(3, new Date(timestamp)), /T10:00$/);

console.log("followup closed-loop regression tests passed");
