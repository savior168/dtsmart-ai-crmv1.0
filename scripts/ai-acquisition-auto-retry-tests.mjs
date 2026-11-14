import assert from "node:assert/strict";
import fs from "node:fs";
import { canAutoRetryAcquisitionItem } from "../lib/ai-acquisition/retry-policy.ts";

const failed = { status: "FAILED", analysis_status: "FAILED", result_id: null, attempt_count: 1, error_code: "22P05", error_context: { retryable: false } };
assert.equal(canAutoRetryAcquisitionItem(failed), true, "NUL failures can resume after sanitization");
assert.equal(canAutoRetryAcquisitionItem({ ...failed, attempt_count: 3 }), false, "retry budget is bounded");
assert.equal(canAutoRetryAcquisitionItem({ ...failed, result_id: "saved" }), false, "durable results must not be reanalyzed");
assert.equal(canAutoRetryAcquisitionItem({ ...failed, error_code: "PERMISSION_DENIED" }), false, "permanent failures require investigation");
assert.equal(canAutoRetryAcquisitionItem({ ...failed, error_code: "HTTP_503", error_context: { retryable: true } }), true);

const workflow = fs.readFileSync(new URL("../workflows/ai-acquisition.ts", import.meta.url), "utf8");
assert.match(workflow, /requeueRecoverableScreeningItems\(screeningTaskId\)[\s\S]*sleep\("20s"\)[\s\S]*dispatchScreening\(screeningTaskId\)/);
assert.match(workflow, /\.lt\("attempt_count", 3\)/);
assert.match(workflow, /\.eq\("status", "FAILED"\)/);
console.log("AI acquisition bounded checkpoint retry tests passed");
