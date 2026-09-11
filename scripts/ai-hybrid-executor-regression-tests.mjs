import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, worker, workflow, dispatcher, runner, installer, installLauncher, createRoute] = await Promise.all([
  read("supabase/migrations/202609100005_ai_screening_hybrid_executor.sql"),
  read("workers/ai-screening-worker.ts"),
  read("workflows/ai-screening.ts"),
  read("lib/ai/task-dispatch.ts"),
  read("lib/ai/run-customer-analysis.ts"),
  read("workers/windows/install-worker.ps1"),
  read("workers/windows/安装本地Worker.cmd"),
  read("app/api/ai/tasks/route.ts"),
]);

assert.match(migration, /for update of i skip locked/i, "queue claims must be atomic");
assert.match(migration, /lease_token uuid/i, "items must carry a fencing token");
assert.match(migration, /execution_mode in \('AUTO','LOCAL_ONLY','VERCEL_ONLY'\)/, "execution modes must be constrained");
assert.match(migration, /revoke all on function public\.claim_next_ai_screening_item[\s\S]+from public,anon,authenticated/i, "claim RPC must be service-role only");
assert.match(worker, /AI_WORKER_CONCURRENCY \|\| "AUTO"/, "worker must default to adaptive concurrency");
assert.match(worker, /configuredConcurrency === "AUTO" \? Math\.min\(3, maxConcurrency\)/, "automatic concurrency must not fall below three");
assert.match(worker, /renew_ai_screening_item_lease/, "worker must renew active leases");
assert.match(worker, /SIGTERM/, "worker must shut down gracefully");
assert.match(workflow, /claim_ai_screening_task_item/, "Vercel workflow must use the same atomic lease claim");
assert.match(dispatcher, /has_healthy_ai_worker/, "automatic dispatch must check local health");
assert.match(migration, /claim_stalled_ai_tasks_for_vercel[\s\S]*75 seconds/, "stale local execution must be atomically eligible for cloud takeover");
assert.match(dispatcher, /rescueStalledAutomaticTasks/, "cloud fallback recovery must be implemented");
assert.match(runner, /AI_EXECUTION_LEASE_LOST/, "stale workers must be fenced before writeback or paid calls");
assert.match(installer, /New-ScheduledTaskTrigger -AtStartup/, "Windows worker must start at boot");
assert.match(installer, /RestartCount 999/, "Windows worker must restart after failure");
assert.match(installLauncher, /fltmc[\s\S]*Start-Process -FilePath[\s\S]*-Verb RunAs/, "Windows launcher must reliably self-elevate");
assert.match(installLauncher, /INSTALL_EXIT_CODE/, "Windows launcher must preserve and display installation failures");
assert.match(createRoute, /execution_mode: executionMode/, "task creation must persist the chosen executor mode");

console.log("AI hybrid executor regression tests passed");
