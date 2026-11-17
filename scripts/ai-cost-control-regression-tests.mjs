import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { remainingAcquisitionTaskLimit } from "../lib/ai-acquisition/cost-budget.ts";

const source = (file) => readFileSync(resolve(file), "utf8");
const migration = source("supabase/migrations/202609100004_ai_screening_cost_modes.sql");
const createView = source("components/ai-screening/create-task-view.tsx");
const taskApi = source("app/api/ai/tasks/route.ts");
const budget = source("lib/api-cost-budget.ts");
const settingsApi = source("app/api/ai/settings/route.ts");
const taskCenter = source("components/ai-screening/task-center-view.tsx");
const costCenter = source("components/cost-center-view.tsx");
const acquisitionDiscovery = source("lib/ai-acquisition/discovery.ts");
const acquisitionWorkflow = source("workflows/ai-acquisition.ts");

assert.match(createView, /智能分析/);
assert.match(createView, /标准分析/);
assert.match(createView, /cost_mode:\s*costMode/);
assert.match(taskApi, /AI_COST_MODES\.includes/);
assert.match(taskApi, /task_cost_limit_usd:\s*taskCostLimit/);

assert.match(migration, /v_amount > 0 and v_task_mode='FREE_ONLY'/);
assert.match(migration, /v_amount > 0 and not v_provider_enabled/);
assert.match(migration, /v_customer_used >= v_customer_limit/);
assert.match(migration, /v_task_used \+ v_amount > v_task_limit/);
assert.match(migration, /v_day_used \+ v_amount > v_day_limit/);
assert.match(migration, /v_week_used \+ v_amount > v_week_limit/);
assert.match(migration, /v_month_used \+ v_amount > v_month_limit/);
assert.match(migration, /if v_amount > 0 then[\s\S]*api_cost_budget_reservations/);
assert.match(budget, /FREE_MODE:[^\n]*本任务采用免费分析模式/);
assert.match(budget, /CUSTOMER:[^\n]*本客户付费调用次数已达到上限/);

assert.match(settingsApi, /permission: acquisition \? "ai\.acquisition\.settings\.manage" : "ai\.settings\.manage"/);
assert.match(settingsApi, /requirePermission\(context\.permission\)/);
assert.match(taskCenter, /show_ai_settings/);
assert.match(taskCenter, /CostModeBadge/);
assert.doesNotMatch(costCenter, /付费API硬性上限/);
assert.match(costCenter, /费用中心只负责查账/);
assert.doesNotMatch(costCenter, /saveLimits/);
assert.match(acquisitionDiscovery, /reserveApiCostBudget\("GOOGLE_PLACES"[\s\S]*taskId: input\.screeningTaskId[\s\S]*api_cost_ledger"\)\.insert\(\{[\s\S]*task_id: input\.screeningTaskId/, "获客搜索的预算预留和费用流水必须使用同一核验任务 ID");
assert.match(acquisitionDiscovery, /if \(ledger\.error\) throw ledger\.error/, "费用流水写入失败不得被静默忽略");
assert.match(acquisitionWorkflow, /legacySearchSpend[\s\S]*\.eq\("task_id", task\.id\)[\s\S]*remainingAcquisitionTaskLimit\(task\.task_cost_limit_usd, legacySearchSpend\)[\s\S]*task_cost_limit_usd: remainingTaskLimit/, "历史父任务搜索费用须从子任务剩余额度扣除");
assert.equal(remainingAcquisitionTaskLimit(10, 2.1), 7.9);
assert.equal(remainingAcquisitionTaskLimit(2, 3), 0);
assert.equal(remainingAcquisitionTaskLimit(null, 3), null);
assert.throws(() => remainingAcquisitionTaskLimit(2, Number.NaN));

console.log("AI筛选模式、权限和费用硬拦截回归测试通过。");
