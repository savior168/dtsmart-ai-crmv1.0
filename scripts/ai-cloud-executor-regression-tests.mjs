import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, workflow, dispatcher, runner, createRoute, retryRoute, settingsRoute, createView, acquisitionCreateView, settingsView, strategiesView, taskUi, acquisitionRecoveryMigration, acquisitionDispatcher, recoveryCron, targetedRecoveryMigration, taskItemExecutor] = await Promise.all([
  read("supabase/migrations/202609110002_ai_screening_vercel_only.sql"),
  read("workflows/ai-screening.ts"),
  read("lib/ai/task-dispatch.ts"),
  read("lib/ai/run-customer-analysis.ts"),
  read("app/api/ai/tasks/route.ts"),
  read("app/api/ai/failures/route.ts"),
  read("app/api/ai/settings/route.ts"),
  read("components/ai-screening/create-task-view.tsx"),
  read("components/ai-acquisition/create-view.tsx"),
  read("components/ai-screening/settings-view.tsx"),
  read("app/ai-screening/strategies/page.tsx"),
  read("components/ai-screening/ui.tsx"),
  read("supabase/migrations/202609190007_ai_acquisition_manual_pause_boundary.sql"),
  read("lib/ai-acquisition/dispatch.ts"),
  read("app/api/cron/ai-task-recovery/route.ts"),
  read("supabase/migrations/202609280004_targeted_ai_screening_recovery.sql"),
  read("lib/ai/task-item-executor.ts"),
]);

assert.match(migration, /ai_default_dispatch_policy = 'VERCEL_ONLY'/, "system default must be cloud-only");
assert.match(migration, /revoke execute on function public\.claim_next_ai_screening_item[\s\S]+from service_role/i, "stale local workers must not claim tasks");
assert.match(migration, /execution_mode = 'VERCEL_ONLY'[\s\S]+dispatch_policy = 'VERCEL_ONLY'/, "unfinished legacy tasks must be cloud-locked");
assert.match(migration, /for update skip locked[\s\S]+active_executor = 'VERCEL_DISPATCHING'/i, "cloud recovery must atomically deduplicate workflow starts");
assert.match(workflow, /claim_ai_screening_task_item[\s\S]+p_executor_type: "VERCEL_WORKFLOW"/, "Vercel workflow must claim items atomically");
assert.doesNotMatch(workflow, /handoffWorkflowFailureToLocal|LOCAL_NODE/, "workflow must never hand failures to a local worker");
assert.match(workflow, /pauseForTransientRecovery[\s\S]+status: "QUEUED"[\s\S]+started_at: null[\s\S]+elapsed_ms: elapsedMs/, "temporary upstream outages must pause rather than inflate effective task duration");
assert.match(workflow, /pause_started_at: null[\s\S]+paused_duration_ms: pausedDuration/, "cloud recovery must record paused time separately before resuming execution");
assert.match(workflow, /WAITING_FOR_RECOVERY[\s\S]+lease_expires_at\.lt\.\$\{now\}/, "a replacement workflow must requeue expired item leases before looking for pending work");
assert.match(taskItemExecutor, /isTransientAnalysisError\(error\) && item\.attemptNumber < 3[\s\S]+status: "PENDING"[\s\S]+lease_owner: null[\s\S]+\.eq\("lease_owner", lease\.executorId\)\.eq\("lease_token", lease\.leaseToken\)/, "transient infrastructure failures must return the leased item to the durable queue with a bounded retry budget");
assert.match(taskItemExecutor, /PUBLIC_SOURCE_NETWORK_UNAVAILABLE/, "public-source network outages must be treated as transient and retried without a business verdict");
assert.match(taskItemExecutor, /if \(!queued\.data\) return \{ status: "LEASE_LOST" as const \}/, "an expired or replaced lease must not requeue another executor's item");
assert.match(workflow, /analyzeTaskItem\.maxRetries = 0/, "a transient database failure must not immediately consume another item attempt");
assert.match(workflow, /Promise\.race\([\s\S]*promise\.then\(\(\) => index, \(\) => index\)[\s\S]*Promise\.allSettled\(active\)/, "a worker failure must await all already-started steps before workflow exit");
const executable = ts.transpileModule(taskItemExecutor, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function executeWithError(analysisError, attemptNumber, currentLease = "lease-1") {
  const writes = [];
  const admin = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        is() { return this; },
        update(values) { writes.push({ table, values }); return this; },
        maybeSingle() {
          if (writes.length) return Promise.resolve({ data: { id: "item-1" }, error: null });
          return Promise.resolve({ data: { analysis_status: "RUNNING", writeback_status: "PENDING", result_id: null, lease_owner: "executor-1", lease_token: currentLease }, error: null });
        },
        then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
      };
    },
    rpc() { return Promise.resolve({ error: null }); },
  };
  const mockModule = { exports: {} };
  const requireMock = (path) => {
    if (path === "../supabase/admin") return { createAdminClient: () => admin };
    if (path === "./error-normalization") return { normalizeError: () => ({ error_code: "TEST", error_message: "failure", retryable: true }) };
    if (path === "./run-customer-analysis") return { runCustomerAnalysis: async () => { throw analysisError; }, publicAiError: () => ({ code: "TEST", message: "failure" }) };
    throw new Error(`Unexpected module: ${path}`);
  };
  new Function("require", "module", "exports", executable)(requireMock, mockModule, mockModule.exports);
  try {
    const result = await mockModule.exports.executeClaimedAiTaskItem({ taskId: "task-1", taskItemId: "item-1", customerId: "customer-1", strategy: "SMART", attemptNumber, leaseToken: "lease-1" }, { executorId: "executor-1", leaseToken: "lease-1" });
    return { result, writes };
  } catch (error) {
    return { error, writes };
  }
}
const transientRetry = await executeWithError({ code: "57014", message: "canceling statement due to statement timeout" }, 1);
assert.equal(transientRetry.error?.code, "57014", "a first statement timeout must pause this workflow run for spaced recovery");
assert.equal(transientRetry.writes[0]?.values.status, "PENDING");
assert.equal(transientRetry.writes.some(({ table }) => table === "customers"), false, "transient failure must not mark the customer failed");
const secondTransientRetry = await executeWithError({ code: "57014", message: "canceling statement due to statement timeout" }, 2);
assert.equal(secondTransientRetry.error?.code, "57014", "the second transient failure must also pause instead of immediately retrying");
assert.equal(secondTransientRetry.writes[0]?.values.status, "PENDING");
const exhaustedRetry = await executeWithError({ code: "57014", message: "canceling statement due to statement timeout" }, 3);
assert.equal(exhaustedRetry.result.status, "FAILED", "the retry budget must prevent endless work");
const permanentFailure = await executeWithError(new Error("INVALID_BUSINESS_INPUT"), 1);
assert.equal(permanentFailure.result.status, "FAILED", "permanent analysis errors must not be requeued");
const replacedLease = await executeWithError({ code: "57014", message: "statement timeout" }, 1, "new-lease");
assert.equal(replacedLease.result.status, "LEASE_LOST", "a replaced lease must not write a stale retry");
assert.equal(replacedLease.writes.length, 0);
assert.match(taskUi, /now - heartbeat > 120_000[\s\S]+activeUntil - started/, "a stale workflow heartbeat must stop task duration from counting recovery wait");
assert.match(dispatcher, /execution_mode: AI_CLOUD_EXECUTION_MODE[\s\S]+dispatch_policy: AI_CLOUD_DISPATCH_POLICY/, "all dispatches must persist cloud-only execution");
assert.match(dispatcher, /rescueStalledCloudTasks[\s\S]+VERCEL_DISPATCHING/, "stalled cloud recovery must remain available without duplicate runs");
assert.match(dispatcher, /reconcileTerminalScreeningTask[\s\S]*refresh_ai_screening_task_totals[\s\S]*success_count[\s\S]*failed_count[\s\S]*pending_count[\s\S]*current_stage[\s\S]*VERCEL_DISPATCHING/, "recovery must only finish an already terminal screening task after refreshing counts and checking its producer");
assert.doesNotMatch(dispatcher, /has_healthy_ai_worker|LOCAL_NODE|LOCAL_FIRST|VERCEL_FIRST/, "dispatcher must not depend on a local worker");
assert.match(runner, /allCollectedSourcesFailedTechnically[\s\S]*PUBLIC_SOURCE_NETWORK_UNAVAILABLE/, "transport failures must stop before business scoring");
assert.match(runner, /publicSourceNetworkFailureDetails[\s\S]*record\.source_url[\s\S]*record\.error/, "public-source failures must retain the attempted endpoint and transport reason for audit");
assert.match(createRoute, /const dispatchPolicy = AI_CLOUD_DISPATCH_POLICY[\s\S]+AI_CLOUD_EXECUTION_MODE/, "new tasks must be cloud-only server-side");
assert.match(retryRoute, /AI_CLOUD_DISPATCH_POLICY[\s\S]+AI_CLOUD_EXECUTION_MODE/, "failed items must retry on Vercel");
assert.match(settingsRoute, /ai_default_dispatch_policy: AI_CLOUD_DISPATCH_POLICY/, "settings API must enforce cloud-only execution");
assert.doesNotMatch(createView, /execution-policy|本地节点|执行策略/, "task creation must not expose executor infrastructure");
assert.doesNotMatch(settingsView, /本地执行器状态|本地优先|仅本地执行|云端优先，本地接管/, "settings must not expose local execution controls");
assert.doesNotMatch(settingsView, /任务执行方式|Vercel 云端 Workflow/, "settings must contain only configurable settings, not a large execution notice");
assert.match(acquisitionCreateView, /云端执行与页面关闭[\s\S]*Vercel 云端 Workflow[\s\S]*关闭页面不会中断任务/, "acquisition rules must document cloud execution and safe page closing");
assert.match(acquisitionCreateView, /任务由云端工作流执行；创建成功后可关闭页面，任务会按计划继续/, "acquisition confirmation must retain a concise cloud execution notice");
assert.match(strategiesView, /所有AI筛选任务均由绑定账户的 Vercel 云端 Workflow 执行/, "strategy documentation must match production behavior");
assert.match(acquisitionRecoveryMigration, /t\.status in \('QUEUED','RUNNING'\)/, "manual pause states must never be claimed by automatic recovery");
assert.doesNotMatch(acquisitionRecoveryMigration, /t\.status in \([^)]*PAUSING/, "PAUSING must remain a user-controlled state");
assert.match(acquisitionDispatcher, /maintenancePausedIds\.has\(taskId\)[\s\S]*state\.data\.status === "PAUSING"[\s\S]*"PAUSED"/, "recovery dispatcher must defensively preserve manual and maintenance pauses");
assert.match(recoveryCron, /recoverWithDeadline\("acquisition", rescueStalledAiAcquisitionTasks\)/, "maintenance mode must still recover explicitly resumed and unrelated acquisition tasks");
assert.doesNotMatch(recoveryCron, /if \(maintenancePaused\.acquisition > 0\)[\s\S]*return NextResponse\.json/, "a stale acquisition maintenance list must not block the entire acquisition queue");
assert.doesNotMatch(recoveryCron, /createAdminClient|applyMaintenancePauses/, "maintenance recovery cron must not keep polling or writing the database");
assert.match(recoveryCron, /rescueStalledCloudTasks\(signal, maintenanceIds\("AI_MAINTENANCE_PAUSED_SCREENING_IDS"\)\)/, "screening recovery must exclude only maintenance-paused tasks");
assert.doesNotMatch(recoveryCron, /maintenancePaused\.screening\s*\?\s*Promise\.resolve/, "one paused screening task must not suppress recovery of all others");
assert.match(dispatcher, /claim_stalled_ai_tasks_for_vercel_excluding/, "screening dispatcher must use targeted exclusion RPC");
assert.match(targetedRecoveryMigration, /not \(t\.id = any\(coalesce\(p_excluded_task_ids,[\s\S]+for update skip locked/i, "targeted screening recovery must exclude paused IDs and atomically claim the rest");

console.log("AI cloud executor regression tests passed");

