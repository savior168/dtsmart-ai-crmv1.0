import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, workflow, dispatcher, runner, createRoute, retryRoute, settingsRoute, createView, settingsView, strategiesView, taskUi] = await Promise.all([
  read("supabase/migrations/202609110002_ai_screening_vercel_only.sql"),
  read("workflows/ai-screening.ts"),
  read("lib/ai/task-dispatch.ts"),
  read("lib/ai/run-customer-analysis.ts"),
  read("app/api/ai/tasks/route.ts"),
  read("app/api/ai/failures/route.ts"),
  read("app/api/ai/settings/route.ts"),
  read("components/ai-screening/create-task-view.tsx"),
  read("components/ai-screening/settings-view.tsx"),
  read("app/ai-screening/strategies/page.tsx"),
  read("components/ai-screening/ui.tsx"),
]);

assert.match(migration, /ai_default_dispatch_policy = 'VERCEL_ONLY'/, "system default must be cloud-only");
assert.match(migration, /revoke execute on function public\.claim_next_ai_screening_item[\s\S]+from service_role/i, "stale local workers must not claim tasks");
assert.match(migration, /execution_mode = 'VERCEL_ONLY'[\s\S]+dispatch_policy = 'VERCEL_ONLY'/, "unfinished legacy tasks must be cloud-locked");
assert.match(migration, /for update skip locked[\s\S]+active_executor = 'VERCEL_DISPATCHING'/i, "cloud recovery must atomically deduplicate workflow starts");
assert.match(workflow, /claim_ai_screening_task_item[\s\S]+p_executor_type: "VERCEL_WORKFLOW"/, "Vercel workflow must claim items atomically");
assert.doesNotMatch(workflow, /handoffWorkflowFailureToLocal|LOCAL_NODE/, "workflow must never hand failures to a local worker");
assert.match(workflow, /pauseForTransientRecovery[\s\S]+status: "QUEUED"[\s\S]+started_at: null[\s\S]+elapsed_ms: elapsedMs/, "temporary upstream outages must pause rather than inflate effective task duration");
assert.match(workflow, /pause_started_at: null[\s\S]+paused_duration_ms: pausedDuration/, "cloud recovery must record paused time separately before resuming execution");
assert.match(taskUi, /now - heartbeat > 120_000[\s\S]+activeUntil - started/, "a stale workflow heartbeat must stop task duration from counting recovery wait");
assert.match(dispatcher, /execution_mode: AI_CLOUD_EXECUTION_MODE[\s\S]+dispatch_policy: AI_CLOUD_DISPATCH_POLICY/, "all dispatches must persist cloud-only execution");
assert.match(dispatcher, /rescueStalledCloudTasks[\s\S]+VERCEL_DISPATCHING/, "stalled cloud recovery must remain available without duplicate runs");
assert.doesNotMatch(dispatcher, /has_healthy_ai_worker|LOCAL_NODE|LOCAL_FIRST|VERCEL_FIRST/, "dispatcher must not depend on a local worker");
assert.match(runner, /allCollectedSourcesFailedTechnically[\s\S]*PUBLIC_SOURCE_NETWORK_UNAVAILABLE/, "transport failures must stop before business scoring");
assert.match(runner, /publicSourceNetworkFailureDetails[\s\S]*record\.source_url[\s\S]*record\.error/, "public-source failures must retain the attempted endpoint and transport reason for audit");
assert.match(createRoute, /const dispatchPolicy = AI_CLOUD_DISPATCH_POLICY[\s\S]+AI_CLOUD_EXECUTION_MODE/, "new tasks must be cloud-only server-side");
assert.match(retryRoute, /AI_CLOUD_DISPATCH_POLICY[\s\S]+AI_CLOUD_EXECUTION_MODE/, "failed items must retry on Vercel");
assert.match(settingsRoute, /ai_default_dispatch_policy: AI_CLOUD_DISPATCH_POLICY/, "settings API must enforce cloud-only execution");
assert.doesNotMatch(createView, /execution-policy|本地节点|执行策略/, "task creation must not expose executor infrastructure");
assert.doesNotMatch(settingsView, /本地执行器状态|本地优先|仅本地执行|云端优先，本地接管/, "settings must not expose local execution controls");
assert.match(settingsView, /Vercel 云端 Workflow/, "settings must state the real execution environment");
assert.match(strategiesView, /所有AI筛选任务均由绑定账户的 Vercel 云端 Workflow 执行/, "strategy documentation must match production behavior");

console.log("AI cloud executor regression tests passed");
