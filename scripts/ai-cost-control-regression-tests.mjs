import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file) => readFileSync(resolve(file), "utf8");
const migration = source("supabase/migrations/202609100004_ai_screening_cost_modes.sql");
const createView = source("components/ai-screening/create-task-view.tsx");
const taskApi = source("app/api/ai/tasks/route.ts");
const budget = source("lib/api-cost-budget.ts");
const settingsApi = source("app/api/ai/settings/route.ts");
const taskCenter = source("components/ai-screening/task-center-view.tsx");
const costCenter = source("components/cost-center-view.tsx");

assert.match(createView, /智能增强分析/);
assert.match(createView, /全免费分析/);
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

assert.match(settingsApi, /requirePermission\("ai\.settings\.manage"\)/);
assert.match(taskCenter, /show_ai_settings/);
assert.match(taskCenter, /CostModeBadge/);
assert.doesNotMatch(costCenter, /付费API硬性上限/);
assert.match(costCenter, /费用中心只负责查账/);
assert.doesNotMatch(costCenter, /saveLimits/);

console.log("AI筛选模式、权限和费用硬拦截回归测试通过。");
