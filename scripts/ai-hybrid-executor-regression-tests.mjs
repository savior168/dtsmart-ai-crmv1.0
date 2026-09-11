import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, policyMigration, worker, workflow, dispatcher, runner, installer, installLauncher, createRoute, batchRoute, createView, settingsView, strategiesView] = await Promise.all([
  read("supabase/migrations/202609100005_ai_screening_hybrid_executor.sql"),
  read("supabase/migrations/202609110001_ai_executor_policy_and_audit.sql"),
  read("workers/ai-screening-worker.ts"),
  read("workflows/ai-screening.ts"),
  read("lib/ai/task-dispatch.ts"),
  read("lib/ai/run-customer-analysis.ts"),
  read("workers/windows/install-worker.ps1"),
  read("workers/windows/安装本地Worker.cmd"),
  read("app/api/ai/tasks/route.ts"),
  read("app/api/ai/tasks/batch/route.ts"),
  read("components/ai-screening/create-task-view.tsx"),
  read("components/ai-screening/settings-view.tsx"),
  read("app/ai-screening/strategies/page.tsx"),
]);

assert.match(migration, /for update of i skip locked/i, "queue claims must be atomic");
assert.match(migration, /lease_token uuid/i, "items must carry a fencing token");
assert.match(migration, /execution_mode in \('AUTO','LOCAL_ONLY','VERCEL_ONLY'\)/, "execution modes must be constrained");
assert.match(migration, /revoke all on function public\.claim_next_ai_screening_item[\s\S]+from public,anon,authenticated/i, "claim RPC must be service-role only");
assert.match(worker, /AI_WORKER_CONCURRENCY \|\| "AUTO"/, "worker must default to adaptive concurrency");
assert.match(worker, /configuredConcurrency === "AUTO" \? Math\.min\(3, maxConcurrency\)/, "automatic concurrency must not fall below three");
assert.match(worker, /Math\.ceil\(os\.cpus\(\)\.length \* 0\.4\)/, "a twelve-thread idle worker must be able to scale to five slots");
assert.match(worker, /renew_ai_screening_item_lease/, "worker must renew active leases");
assert.match(worker, /SIGTERM/, "worker must shut down gracefully");
assert.match(worker, /analysis_ready: analysisReady/, "worker heartbeat must report verified analysis readiness");
assert.match(worker, /google_maps_public[\s\S]*google_places_host[\s\S]*openai_host/, "worker must preflight every external analysis channel without billable calls");
assert.match(worker, /if \(!analysisReady\) return null/, "an unverified local node must not claim customers");
assert.match(runner, /allCollectedSourcesFailedTechnically[\s\S]*PUBLIC_SOURCE_NETWORK_UNAVAILABLE/, "all-source transport failures must stop before business scoring");
assert.match(runner, /PUBLIC_SOURCE_NETWORK_UNAVAILABLE[\s\S]*未生成客户评分或有效性结论/, "all-source transport failures must be reported as an explicit technical failure");
assert.match(workflow, /claim_ai_screening_task_item/, "Vercel workflow must use the same atomic lease claim");
assert.match(dispatcher, /has_healthy_ai_worker/, "automatic dispatch must check local health");
assert.match(dispatcher, /dispatchPolicy === "LOCAL_FIRST"[\s\S]*execution_mode: "VERCEL_ONLY"/, "local-first cloud fallback must lock out local claims until explicit handoff");
assert.match(workflow, /\["VERCEL_FIRST","LOCAL_FIRST"\][\s\S]*execution_mode:"AUTO"/, "either hybrid policy must explicitly hand a failed cloud run back to a verified local node");
assert.match(migration, /claim_stalled_ai_tasks_for_vercel[\s\S]*75 seconds/, "stale local execution must be atomically eligible for cloud takeover");
assert.match(dispatcher, /rescueStalledAutomaticTasks/, "cloud fallback recovery must be implemented");
assert.match(runner, /AI_EXECUTION_LEASE_LOST/, "stale workers must be fenced before writeback or paid calls");
assert.match(installer, /New-ScheduledTaskTrigger -AtStartup/, "Windows worker must start at boot");
assert.match(installer, /RestartCount 999/, "Windows worker must restart after failure");
assert.match(installer, /Stop-ScheduledTask[\s\S]*installedNodePath[\s\S]*Get-Process -Name node[\s\S]*Stop-Process -Id/, "repair install must stop only the existing bundled worker before replacing its runtime");
assert.match(installer, /Wait-Process -Id[\s\S]*旧版Worker进程未能停止/, "repair install must confirm the old runtime released its executable before copying files");
assert.match(installer, /Start-Process notepad\.exe[\s\S]*configurationDeadline[\s\S]*Read-WorkerEnvironment[\s\S]*Start-Sleep -Seconds 2/, "installer must detect saved configuration without waiting for the Windows 11 Notepad process to exit");
assert.doesNotMatch(installer, /Start-Process notepad\.exe[^\r\n]*-Wait/, "installer must not wait for the multi-tab Notepad process to exit");
assert.match(installer, /worker_online[\s\S]*30秒内没有收到Worker上线日志/, "installer must verify an actual worker heartbeat log before reporting success");
assert.match(installer, /existingLogLineCount[\s\S]*Select-Object -Skip \$existingLogLineCount[\s\S]*worker_online/, "installer must only accept a fresh heartbeat written by the current start attempt");
assert.match(installLauncher, /fltmc[\s\S]*Start-Process -FilePath '%~f0' -Verb RunAs -Wait -PassThru/, "Windows launcher must elevate by relaunching itself so detailed errors remain visible");
assert.match(installLauncher, /INSTALL_EXIT_CODE/, "Windows launcher must preserve and display installation failures");
assert.doesNotMatch(installLauncher, /[^\x00-\x7F]/, "Windows cmd launcher must remain pure ASCII for legacy cmd.exe compatibility");
assert.match(installLauncher, /\r\n/, "Windows cmd launcher must use CRLF line endings");
assert.match(createRoute, /execution_mode: executionMode/, "task creation must persist the chosen executor mode");
assert.match(createRoute, /ai_default_dispatch_policy/, "the API must read the centrally managed dispatch policy");
assert.match(createRoute, /dispatch_policy: dispatchPolicy/, "task creation must persist an immutable policy snapshot");
assert.doesNotMatch(createRoute, /body\.execution_mode/, "clients must not be able to force a specific execution node");
assert.doesNotMatch(createView, /execution_mode:/, "task creation must leave node selection to the server scheduler");
assert.doesNotMatch(createView, /setExecutionMode|仅本地 Worker|仅 Vercel 云端/, "task creation must not expose infrastructure node selection");
assert.match(policyMigration, /VERCEL_FIRST','LOCAL_FIRST','VERCEL_ONLY','LOCAL_ONLY/, "only explicit, auditable scheduling policies may be stored");
assert.doesNotMatch(policyMigration, /'SMART'/, "ambiguous smart scheduling must not be persisted");
assert.match(policyMigration, /executor_history[\s\S]*record_ai_task_item_executor/, "task and customer execution attribution must be durable");
assert.match(policyMigration, /tg_op = 'INSERT' or old\.executor_type is distinct from new\.executor_type/, "executor audit trigger must support both inserts and updates safely");
assert.match(policyMigration, /metadata->>'analysis_ready'/, "database health checks must require verified analysis readiness");
assert.match(policyMigration, /archive_ai_screening_tasks[\s\S]*for update[\s\S]*BATCH_ARCHIVE_VALIDATION_FAILED/, "batch archive must validate and lock the whole selection atomically");
assert.match(batchRoute, /requirePermission\("ai\.tasks\.delete"\)/, "batch archive must enforce the delete permission in the API");
assert.match(batchRoute, /account\.role!=="ADMIN"[\s\S]*user_id/, "non-admins must never batch archive another user's tasks");
assert.match(settingsView, /setInterval\(\(\)=>void refreshWorkers\(\),10000\)[\s\S]*本地执行器状态/, "worker health must be monitored live from the settings page");
assert.match(settingsView, /云端优先，本地接管[\s\S]*本地优先，云端接管[\s\S]*仅云端执行[\s\S]*仅本地执行/, "settings must expose four explicit policies");
assert.doesNotMatch(settingsView, /智能调度（推荐）/, "settings must not show an ambiguous scheduler choice");
assert.match(createView, /execution-policy[\s\S]*执行策略由管理员统一配置/, "task creation must show the current server policy as read-only");
assert.match(strategiesView, /智能增强分析[\s\S]*全免费分析[\s\S]*执行器策略由管理员统一配置/, "strategy documentation must reflect cost modes and managed execution policy");

console.log("AI hybrid executor regression tests passed");
