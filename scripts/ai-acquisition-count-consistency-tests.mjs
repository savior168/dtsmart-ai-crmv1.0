import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { loadAcquisitionTaskSummary } = await jiti.import(resolve("lib/ai-acquisition/task-center-summary.ts"));
const { countAcquisitionCandidateDecisions } = await jiti.import(resolve("lib/ai-acquisition/decision-counts.ts"));
const source = (path) => readFileSync(resolve(path), "utf8");

class Query {
  constructor(rows) { this.rows = rows; this.predicates = []; this.head = false; }
  select(_columns, options = {}) { this.head = Boolean(options.head); return this; }
  eq(field, value) { this.predicates.push((row) => row[field] === value); return this; }
  in(field, values) { this.predicates.push((row) => values.includes(row[field])); return this; }
  overlaps(field, values) { this.predicates.push((row) => Array.isArray(row[field]) && row[field].some((item) => values.includes(item))); return this; }
  gte(field, value) { this.predicates.push((row) => row[field] >= value); return this; }
  lte(field, value) { this.predicates.push((row) => row[field] <= value); return this; }
  or() { return this; }
  order() { return this; }
  result(start = 0, end = Infinity) {
    const matched = this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
    return { data: this.head ? null : matched.slice(start, end + 1), count: matched.length, error: null };
  }
  range(start, end) { return Promise.resolve(this.result(start, end)); }
  then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); }
}

const tasks = [
  { id: "task-one", status: "COMPLETED", accepted_count: 100, review_count: 41 },
  { id: "task-two", status: "COMPLETED", accepted_count: 0, review_count: 0 },
];
const candidates = [
  ...Array.from({ length: 60 }, (_, index) => ({ id: `review-one-${index}`, task_id: "task-one", decision: "REVIEW", imported_customer_id: null, processed_at: "2026-09-28T10:00:00Z" })),
  ...Array.from({ length: 5 }, (_, index) => ({ id: `review-two-${index}`, task_id: "task-two", decision: "REVIEW", imported_customer_id: null, processed_at: "2026-09-28T10:00:00Z" })),
  { id: "accepted-one", task_id: "task-one", decision: "ACCEPTED", imported_customer_id: "customer-one", processed_at: "2026-09-29T02:00:00Z" },
  { id: "accepted-two", task_id: "task-two", decision: "ACCEPTED", imported_customer_id: "customer-two", processed_at: "2026-09-28T02:00:00Z" },
  { id: "accepted-unlinked", task_id: "task-one", decision: "ACCEPTED", imported_customer_id: null, processed_at: "2026-09-28T02:00:00Z" },
];
const customers = ["customer-one", "customer-two"].map((id) => ({ id, company_name: id, deleted_at: null, acquisition_scope: "PUBLIC_POOL", pool_status: "AVAILABLE", status: "UNCLAIMED", owner_id: null }));
const admin = { from(table) { return new Query({ ai_acquisition_tasks: tasks, ai_acquisition_candidates: candidates, customers }[table] || []); } };
const filters = { ownerId: null, costMode: "", countries: [], industries: [], from: "", to: "", search: "", today: "2026-09-29" };
const summary = await loadAcquisitionTaskSummary(admin, filters);
assert.equal(summary.review, 65, "待复核卡片必须读取候选实际状态，而非任务表中的旧快照41");
assert.deepEqual(summary.review_by_task, { "task-one": 60, "task-two": 5 });
assert.equal(summary.accepted, 2, "有效入池结果必须与可点击列表一样只统计仍关联客户的记录");
assert.deepEqual(summary.accepted_by_task, { "task-one": 1, "task-two": 1 });
assert.equal(summary.historical_accepted, 3, "历史累计也要从候选决策计算，不得相信任务快照100");
assert.equal(summary.removed_results, 1);
assert.equal(summary.today_accepted, 1);

const manyCandidates = Array.from({ length: 1300 }, (_, index) => ({ id: `accepted-${index}`, task_id: "large-task", decision: "ACCEPTED" }));
manyCandidates.push(...Array.from({ length: 65 }, (_, index) => ({ id: `review-${index}`, task_id: "large-task", decision: "REVIEW" })));
const largeAdmin = { from() { return new Query(manyCandidates); } };
assert.deepEqual(await countAcquisitionCandidateDecisions(largeAdmin, "large-task"), { accepted_count: 1300, review_count: 65, rejected_count: 0, duplicate_count: 0 }, "人工复核写回不得受单页1000条限制");

const taskRoute = source("app/api/ai-acquisition/tasks/route.ts");
const resultRoute = source("app/api/ai-acquisition/customers/route.ts");
const taskCenter = source("components/ai-acquisition/task-center.tsx");
const resultView = source("components/ai-acquisition/customer-results.tsx");
assert.match(taskRoute, /\["accepted", "today_accepted", "review"\]\.includes\(metric\)[\s\S]*?eq\("decision", metric === "review" \? "REVIEW" : "ACCEPTED"\)/);
assert.doesNotMatch(taskRoute, /metric === "review"\) query = query\.gt\("review_count"/);
for (const name of ["task_cost_mode", "task_country", "task_industry", "task_from", "task_to", "task_search"]) {
  assert.ok(taskCenter.includes(name), `任务中心链接缺少${name}`);
  assert.ok(resultRoute.includes(name), `客户结果API缺少${name}`);
}
assert.match(resultView, /new URLSearchParams\(taskOriginQuery\)/);
assert.match(resultRoute, /optionsCacheKey = JSON\.stringify\(\[ownerId[\s\S]*taskCountries[\s\S]*taskIndustries/);
console.log("AI获客总览、跳转范围和复核计数一致性测试通过");
