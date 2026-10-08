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
for (const source of [api, exportApi]) {
  assert.match(source, /params\.get\("stage"\)/, "列表和导出必须读取同一客户阶段筛选");
  assert.match(source, /params\.getAll\("country"\)/, "列表和导出必须读取同一国家筛选");
  assert.match(source, /query = query\.eq\("status", stage\)/, "列表和导出必须应用客户阶段筛选");
  assert.match(source, /query = query\.in\("country", countryFilterRawValues\(countries\)\)/, "列表和导出必须匹配历史国家写法");
}
assert.match(view, /countries\.forEach\(country=>exportParams\.append\("country",country\)\)/, "导出必须保留列表国家筛选");
assert.match(view, /if\(stage\)exportParams\.set\("stage",stage\)/, "导出必须保留列表客户阶段筛选");

assert.match(view, /scope==="history"\?"当时约定":"计划时间"[\s\S]*scope==="history"\?"未约定":"待安排"/, "历史记录未约定日期不得误显示成当前待安排");
assert.match(dashboard, /followupDayBounds\(now\)[\s\S]*customer_followup_queue/, "工作台今日待办必须与跟进管理一致");
assert.match(view, /待安排[\s\S]*action=followup&from=followups/, "未安排客户应可直接进入跟进录入");
assert.match(detail, /new Date\(draft\.next_follow_date\)\.toISOString\(\)/, "浏览器本地时间保存前必须转换为带时区时间");
assert.match(correction, /editReason\.length < 5[\s\S]*correct_customer_followup/, "历史更正必须提交原因并调用原子事务");
assert.match(migration, /correct_customer_followup[\s\S]*for update[\s\S]*'before'[\s\S]*'after'/, "历史更正事务必须锁定归属并保留前后审计");

const timestamp = "2026-09-30T02:00:00.000Z";
assert.equal(new Date(localDateTimeInput(timestamp)).toISOString(), timestamp);
assert.match(quickLocalDateTime(3, new Date(timestamp)), /T10:00$/);

const presetDays = [1, 3, 7];
for (const { now, expected } of [
  { now: new Date(2026, 8, 15, 18, 42, 17), expected: ["2026-09-16T10:00", "2026-09-18T10:00", "2026-09-22T10:00"] },
  { now: new Date(2026, 0, 31, 23, 59, 59), expected: ["2026-02-01T10:00", "2026-02-03T10:00", "2026-02-07T10:00"] },
  { now: new Date(2026, 11, 31, 23, 59, 59), expected: ["2027-01-01T10:00", "2027-01-03T10:00", "2027-01-07T10:00"] },
  { now: new Date(2028, 1, 28, 8, 15), expected: ["2028-02-29T10:00", "2028-03-02T10:00", "2028-03-06T10:00"] },
]) {
  const originalTime = now.getTime();
  const values = presetDays.map((days) => quickLocalDateTime(days, now));
  assert.deepEqual(values, expected, "快捷日期必须按当地日历准确增加 1、3、7 天，并固定为 10:00");
  assert.equal(new Set(values).size, presetDays.length, "三个快捷日期不得重复");
  assert.equal(now.getTime(), originalTime, "计算快捷日期不得修改调用方的当前时间");
  for (const [index, value] of values.entries()) {
    assert.deepEqual(values.map((candidate) => candidate === value), presetDays.map((_, candidateIndex) => candidateIndex === index), "实际值只能命中一个快捷选项");
    assert.equal(values.includes(value.replace("T10:00", "T10:01")), false, "手动改分钟后不再命中原快捷选项");
    assert.equal(values.includes(value.replace("T10:00", "T11:00")), false, "手动改小时后不再命中原快捷选项");
  }
  assert.equal(values.includes(""), false, "清空安排后不得命中快捷选项");
}

console.log("followup closed-loop regression tests passed");
