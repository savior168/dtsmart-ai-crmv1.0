import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, worker, workflow, dispatcher, runner, installer, installLauncher, createRoute, createView, settingsView, strategiesView] = await Promise.all([
  read("supabase/migrations/202609100005_ai_screening_hybrid_executor.sql"),
  read("workers/ai-screening-worker.ts"),
  read("workflows/ai-screening.ts"),
  read("lib/ai/task-dispatch.ts"),
  read("lib/ai/run-customer-analysis.ts"),
  read("workers/windows/install-worker.ps1"),
  read("workers/windows/安装本地Worker.cmd"),
  read("app/api/ai/tasks/route.ts"),
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
assert.match(workflow, /claim_ai_screening_task_item/, "Vercel workflow must use the same atomic lease claim");
assert.match(dispatcher, /has_healthy_ai_worker/, "automatic dispatch must check local health");
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
assert.match(createRoute, /const executionMode = "AUTO" as const/, "the API must centrally enforce automatic scheduling");
assert.doesNotMatch(createRoute, /body\.execution_mode/, "clients must not be able to force a specific execution node");
assert.doesNotMatch(createView, /execution_mode:/, "task creation must leave node selection to the server scheduler");
assert.doesNotMatch(createView, /setExecutionMode|仅本地 Worker|仅 Vercel 云端/, "task creation must not expose infrastructure node selection");
assert.match(settingsView, /heartbeatAgeSeconds[\s\S]*setInterval\(\(\)=>void refreshWorkers\(\),10000\)[\s\S]*任务执行节点/, "worker health must be monitored live from the settings page");
assert.match(strategiesView, /智能增强分析[\s\S]*全免费分析[\s\S]*执行节点自动调度/, "strategy documentation must reflect both real cost modes and automatic scheduling");

console.log("AI hybrid executor regression tests passed");
