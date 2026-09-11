import os from "node:os";
import { createAdminClient } from "../lib/supabase/admin";
import { executeClaimedAiTaskItem, type ClaimedAiTaskItem } from "../lib/ai/task-item-executor";
import type { AiStrategy } from "../lib/ai/task-types";

const VERSION = "1.1.0";
const workerId = process.env.AI_WORKER_ID || `dtsmart-${os.hostname().toLowerCase()}`;
const displayName = process.env.AI_WORKER_NAME || `${os.hostname()} 本地分析节点`;
const configuredConcurrency = String(process.env.AI_WORKER_CONCURRENCY || "AUTO").toUpperCase();
const autoMaxConcurrency = Math.min(5, Math.max(3, Math.ceil(os.cpus().length * 0.4)));
const maxConcurrency = configuredConcurrency === "AUTO"
  ? autoMaxConcurrency
  : Math.min(5, Math.max(1, Number(configuredConcurrency) || 4));
const minConcurrency = configuredConcurrency === "AUTO" ? Math.min(3, maxConcurrency) : maxConcurrency;
let desiredConcurrency = Math.min(3, maxConcurrency);
const pollMs = Math.min(15_000, Math.max(500, Number(process.env.AI_WORKER_POLL_MS || 1500)));
const leaseSeconds = Math.min(3600, Math.max(300, Number(process.env.AI_WORKER_LEASE_SECONDS || 1800)));
const admin = createAdminClient();
let stopping = false;
let activeCount = 0;
type ChannelHealth = { ok:boolean; checked_at:string; latency_ms:number; error?:string };
let channelHealth:Record<string,ChannelHealth> = {};
let analysisReady = false;

function log(event: string, details: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, workerId, ...details })}\n`);
}

async function heartbeat() {
  const result = await admin.rpc("heartbeat_ai_worker", {
    p_worker_id: workerId, p_display_name: displayName, p_host_name: os.hostname(),
    p_worker_version: VERSION, p_concurrency: desiredConcurrency, p_active_count: activeCount,
    p_metadata: { platform: process.platform, node: process.version, pid: process.pid, max_concurrency: maxConcurrency, adaptive: configuredConcurrency === "AUTO", analysis_ready: analysisReady, channel_health: channelHealth },
  });
  if (result.error) throw result.error;
}

async function probe(name:string,url:string) {
  const started=Date.now();
  try {
    await fetch(url,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(8_000),headers:{"User-Agent":"DTSmart-AI-Worker-Health/1.1"}});
    return [name,{ok:true,checked_at:new Date().toISOString(),latency_ms:Date.now()-started}] as const;
  } catch(error) {
    return [name,{ok:false,checked_at:new Date().toISOString(),latency_ms:Date.now()-started,error:(error instanceof Error?error.message:String(error)).slice(0,160)}] as const;
  }
}

async function preflight() {
  const checks=await Promise.all([
    probe("public_web","https://example.com/"),
    probe("google_maps_public","https://www.google.com/maps"),
    probe("google_places_host","https://places.googleapis.com/"),
    probe("openai_host","https://api.openai.com/v1/models"),
  ]);
  channelHealth=Object.fromEntries(checks);
  analysisReady=checks.every(([,value])=>value.ok);
  log("network_preflight",{analysisReady,channels:Object.fromEntries(checks.map(([name,value])=>[name,{ok:value.ok,latency_ms:value.latency_ms}]))});
  return analysisReady;
}

async function claim(): Promise<ClaimedAiTaskItem | null> {
  if (!analysisReady) return null;
  const result = await admin.rpc("claim_next_ai_screening_item", {
    p_worker_id: workerId, p_lease_seconds: leaseSeconds,
  });
  if (result.error) throw result.error;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return null;
  return {
    taskId: row.task_id, taskItemId: row.task_item_id, customerId: row.customer_id,
    strategy: row.strategy as AiStrategy, attemptNumber: Number(row.attempt_number || 1),
    leaseToken: row.lease_token,
  };
}

async function settleTask(taskId: string) {
  await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId });
  const task = await admin.from("ai_screening_tasks").select("status,pending_count,elapsed_ms,started_at").eq("id", taskId).maybeSingle();
  if (task.error || !task.data || ["PAUSED", "PAUSING", "CANCELLED"].includes(task.data.status)) return;
  const active = await admin.from("ai_screening_task_items").select("id", { count: "exact", head: true }).eq("task_id", taskId).in("status", ["PENDING", "RUNNING"]);
  if (active.error || Number(active.count || 0) > 0) return;
  const now = new Date();
  const startedAt = task.data.started_at ? new Date(task.data.started_at).getTime() : NaN;
  const elapsedMs = Number(task.data.elapsed_ms || 0) + (Number.isFinite(startedAt) ? Math.max(0, now.getTime() - startedAt) : 0);
  await admin.from("ai_screening_tasks").update({
    status: "COMPLETED", completed_at: now.toISOString(), finished_at: now.toISOString(),
    elapsed_ms: elapsedMs, active_executor: "LOCAL_NODE", executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("id", taskId).in("status", ["QUEUED", "RUNNING"]);
}

async function processItem(item: ClaimedAiTaskItem) {
  activeCount += 1;
  log("item_started", { taskId: item.taskId, itemId: item.taskItemId });
  const renew = setInterval(async () => {
    const result = await admin.rpc("renew_ai_screening_item_lease", {
      p_item_id: item.taskItemId, p_lease_token: item.leaseToken,
      p_executor_id: workerId, p_lease_seconds: leaseSeconds,
    });
    if (result.error || !result.data) log("lease_renew_failed", { itemId: item.taskItemId, error: result.error?.message });
  }, Math.min(30_000, Math.floor(leaseSeconds * 250)));
  renew.unref();
  try {
    const result = await executeClaimedAiTaskItem(item, { executorId: workerId, leaseToken: item.leaseToken });
    log("item_finished", { taskId: item.taskId, itemId: item.taskItemId, status: result.status });
  } catch (error) {
    log("item_exception", { taskId: item.taskId, itemId: item.taskItemId, error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearInterval(renew);
    await admin.rpc("release_ai_screening_item_lease", { p_item_id: item.taskItemId, p_lease_token: item.leaseToken, p_executor_id: workerId });
    await settleTask(item.taskId);
    activeCount -= 1;
  }
}

async function workerSlot(slot: number) {
  let backoff = pollMs;
  while (!stopping) {
    if (slot > desiredConcurrency) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    try {
      const item = await claim();
      if (item) {
        backoff = pollMs;
        await processItem(item);
      } else {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (error) {
      log("poll_error", { slot, error: error instanceof Error ? error.message : String(error), retryMs: backoff });
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(30_000, backoff * 2);
    }
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log("shutdown_requested", { signal, activeCount });
  const deadline = Date.now() + 30_000;
  while (activeCount > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  await admin.rpc("stop_ai_worker", { p_worker_id: workerId });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (error) => { log("uncaught_exception", { error: error.message }); process.exitCode = 1; });
process.on("unhandledRejection", (error) => { log("unhandled_rejection", { error: String(error) }); process.exitCode = 1; });

async function main() {
  await preflight();
  await heartbeat();
  log("worker_online", { host: os.hostname(), concurrency: desiredConcurrency, maxConcurrency, pollMs, leaseSeconds, version: VERSION });
  const heartbeatTimer = setInterval(() => void heartbeat().catch((error) => log("heartbeat_error", { error: error.message })), 15_000);
  const preflightTimer = setInterval(() => void preflight().then(()=>heartbeat()).catch((error)=>log("preflight_error",{error:error instanceof Error?error.message:String(error)})),60_000);
  preflightTimer.unref();
  let previousCpu = os.cpus().map((cpu) => ({ idle: cpu.times.idle, total: Object.values(cpu.times).reduce((sum, value) => sum + value, 0) }));
  const capacityTimer = setInterval(() => {
    const current = os.cpus();
    const usage = current.reduce((sum, cpu, index) => {
      const total = Object.values(cpu.times).reduce((all, value) => all + value, 0);
      const totalDelta = Math.max(1, total - previousCpu[index].total);
      return sum + (1 - ((cpu.times.idle - previousCpu[index].idle) / totalDelta));
    }, 0) / current.length;
    previousCpu = current.map((cpu) => ({ idle: cpu.times.idle, total: Object.values(cpu.times).reduce((sum, value) => sum + value, 0) }));
    const freeGb = os.freemem() / 1024 / 1024 / 1024;
    const before = desiredConcurrency;
    if (freeGb < 2 || usage > 0.85) desiredConcurrency = Math.max(minConcurrency, desiredConcurrency - 1);
    else if (freeGb > 3 && usage < 0.7) desiredConcurrency = Math.min(maxConcurrency, desiredConcurrency + 1);
    if (before !== desiredConcurrency) log("concurrency_adjusted", { from: before, to: desiredConcurrency, cpuPercent: Math.round(usage * 100), freeMemoryGb: Number(freeGb.toFixed(2)) });
  }, 10_000);
  capacityTimer.unref();
  await Promise.all(Array.from({ length: maxConcurrency }, (_, index) => workerSlot(index + 1)));
  clearInterval(heartbeatTimer);
  clearInterval(preflightTimer);
  clearInterval(capacityTimer);
}

void main().catch((error) => { log("startup_failed", { error: error instanceof Error ? error.message : String(error) }); process.exit(1); });
