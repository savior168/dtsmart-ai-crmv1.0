import { NextRequest, NextResponse } from "next/server";
import { rescueStalledCloudTasks } from "@/lib/ai/task-dispatch";
import { rescueStalledAiAcquisitionTasks } from "@/lib/ai-acquisition/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const RECOVERY_DEADLINE_MS = 12_000;
const MAINTENANCE_PAUSE_DEADLINE_MS = 8_000;

function maintenanceIds(name: string) {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[0-9a-f-]{36}$/i.test(value));
}

async function applyMaintenancePauses() {
  const acquisitionIds = maintenanceIds("AI_MAINTENANCE_PAUSED_ACQUISITION_IDS");
  const screeningIds = maintenanceIds("AI_MAINTENANCE_PAUSED_SCREENING_IDS");
  if (!acquisitionIds.length && !screeningIds.length) return { acquisition: 0, screening: 0 };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const [acquisition, screening] = await Promise.all([
    acquisitionIds.length
      ? admin.from("ai_acquisition_tasks").update({ status: "PAUSED", current_stage_detail: "系统维护暂停；仅允许人工继续执行", started_at: null, active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: now }).in("id", acquisitionIds).in("status", ["QUEUED", "RUNNING", "PAUSING"]).select("id")
      : Promise.resolve({ data: [], error: null }),
    screeningIds.length
      ? admin.from("ai_screening_tasks").update({ status: "PAUSED", active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: now }).in("id", screeningIds).in("status", ["QUEUED", "RUNNING", "PAUSING"]).select("id")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (acquisition.error || screening.error) throw acquisition.error || screening.error;
  return { acquisition: acquisition.data?.length || 0, screening: screening.data?.length || 0 };
}

async function applyMaintenancePausesWithDeadline() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      applyMaintenancePauses(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("MAINTENANCE_PAUSE_TIMEOUT")), MAINTENANCE_PAUSE_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function recoverWithDeadline(label: string, recover: (signal: AbortSignal) => Promise<number>) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  console.info(`[ai-task-recovery] ${label} started`);
  try {
    const recovered = await Promise.race([
      recover(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label.toUpperCase()}_RECOVERY_TIMEOUT`));
        }, RECOVERY_DEADLINE_MS);
      }),
    ]);
    console.info(`[ai-task-recovery] ${label} completed`, { recovered, duration_ms: Date.now() - startedAt });
    return { recovered, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ai-task-recovery] ${label} failed`, { error: message, duration_ms: Date.now() - startedAt });
    return { recovered: 0, error: message };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// Recovery must not depend on a salesperson leaving the task-list page open.
// Vercel Cron sends this secret as a Bearer token on each production request.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const maintenancePaused = await applyMaintenancePausesWithDeadline();
    const [screening, acquisition] = await Promise.all([
      recoverWithDeadline("screening", rescueStalledCloudTasks),
      recoverWithDeadline("acquisition", rescueStalledAiAcquisitionTasks),
    ]);
    return NextResponse.json({
      ok: !screening.error && !acquisition.error,
      recovered: screening.recovered + acquisition.recovered,
      screening_recovered: screening.recovered,
      acquisition_recovered: acquisition.recovered,
      screening_error: screening.error,
      acquisition_error: acquisition.error,
      maintenance_paused: maintenancePaused,
    });
  } catch (error) {
    console.error("[ai-task-recovery] cron rescue failed", error);
    return NextResponse.json({ error: "AI_TASK_RECOVERY_FAILED" }, { status: 500 });
  }
}
