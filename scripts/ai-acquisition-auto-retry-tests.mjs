import assert from "node:assert/strict";
import fs from "node:fs";
import { canAutoRetryAcquisitionItem } from "../lib/ai-acquisition/retry-policy.ts";
import { canInvalidateStagingCustomer, stagingCustomerBelongsToTask } from "../lib/ai-acquisition/staging-ownership.ts";

const failed = { status: "FAILED", analysis_status: "FAILED", result_id: null, attempt_count: 1, error_code: "22P05", error_context: { retryable: false } };
assert.equal(canAutoRetryAcquisitionItem(failed), true, "NUL failures can resume after sanitization");
assert.equal(canAutoRetryAcquisitionItem({ ...failed, attempt_count: 3 }), false, "retry budget is bounded");
assert.equal(canAutoRetryAcquisitionItem({ ...failed, result_id: "saved" }), false, "durable results must not be reanalyzed");
assert.equal(canAutoRetryAcquisitionItem({ ...failed, error_code: "PERMISSION_DENIED" }), false, "permanent failures require investigation");
assert.equal(canAutoRetryAcquisitionItem({ ...failed, error_code: "HTTP_503", error_context: { retryable: true } }), true);
assert.equal(stagingCustomerBelongsToTask({ pool_status: "AI_STAGING", source_reference: "task-a" }, "task-a"), true);
assert.equal(stagingCustomerBelongsToTask({ pool_status: "AI_STAGING", source_reference: "task-a" }, "task-b"), false, "跨任务暂存客户不得复用");
assert.equal(stagingCustomerBelongsToTask({ pool_status: "AVAILABLE", source_reference: "task-a" }, "task-a"), false);
assert.equal(canInvalidateStagingCustomer(2), false, "仍被其他核验或复核候选引用时不得软删除暂存客户");
assert.equal(canInvalidateStagingCustomer(1), true);

const workflow = fs.readFileSync(new URL("../workflows/ai-acquisition.ts", import.meta.url), "utf8");
const taskRoute = fs.readFileSync(new URL("../app/api/ai-acquisition/tasks/[id]/route.ts", import.meta.url), "utf8");
assert.match(workflow, /stagingCustomerBelongsToTask\(row,task\.id\)/);
assert.match(workflow, /canInvalidateStagingCustomer\(stagingUsersByCustomer\.get\(customerId\) \|\| 0\)/);
assert.match(taskRoute, /mustIsolate = \(customerId: string\)[\s\S]*sharedIds\.has\(customerId\)[\s\S]*oldCustomer\?\.deleted_at[\s\S]*\.eq\("source_reference", id\)/,
  "仅任务独占暂存客户可原位恢复");
assert.match(taskRoute, /existingReplacement[\s\S]*ISOLATE_SHARED_STAGING_CUSTOMER[\s\S]*ai_screening_task_items"\)\.update\(\{ customer_id: customerId \}\)/,
  "共享暂存客户重试时必须新建任务专属客户并重新关联");
assert.match(workflow, /requeueRecoverableScreeningItems\(screeningTaskId\)[\s\S]*sleep\("20s"\)[\s\S]*dispatchScreening\(screeningTaskId\)/);
assert.match(workflow, /\.lt\("attempt_count", 3\)/);
assert.match(workflow, /\.eq\("status", "FAILED"\)/);
console.log("AI acquisition bounded checkpoint retry tests passed");
