import { NextRequest, NextResponse } from "next/server";
import { rescueStalledCloudTasks } from "@/lib/ai/task-dispatch";
import { rescueStalledAiAcquisitionTasks } from "@/lib/ai-acquisition/dispatch";

export const maxDuration = 60;

// Recovery is a safety net, never a foreground workload. If the database is
// busy, yield quickly and retry on the next cron tick instead of occupying
// capacity needed by login and business pages.
const RECOVERY_DEADLINE_MS = 4_000;

function maintenanceIds(name: string) {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[0-9a-f-]{36}$/i.test(value));
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
  const maintenancePaused = {
    acquisition: maintenanceIds("AI_MAINTENANCE_PAUSED_ACQUISITION_IDS").length,
    screening: maintenanceIds("AI_MAINTENANCE_PAUSED_SCREENING_IDS").length,
  };
  if (maintenancePaused.acquisition > 0) {
    return NextResponse.json({
      ok: true,
      maintenance_mode: true,
      maintenance_paused: maintenancePaused,
      recovered: 0,
      screening_recovered: 0,
      acquisition_recovered: 0,
    });
  }
  try {
    // A maintenance-paused screening task has no safe per-task recovery marker,
    // so skip only that queue. Acquisition recovery still closes manual pause
    // transitions and recovers unrelated acquisition tasks.
    const screeningRecovery = maintenancePaused.screening
      ? Promise.resolve({ recovered: 0, error: null, skipped: true })
      : recoverWithDeadline("screening", rescueStalledCloudTasks);
    const [screening, acquisition] = await Promise.all([
      screeningRecovery,
      recoverWithDeadline("acquisition", rescueStalledAiAcquisitionTasks),
    ]);
    return NextResponse.json({
      ok: !screening.error && !acquisition.error,
      maintenance_mode: maintenancePaused.acquisition > 0 || maintenancePaused.screening > 0,
      maintenance_paused: maintenancePaused,
      recovered: screening.recovered + acquisition.recovered,
      screening_recovered: screening.recovered,
      screening_recovery_skipped: "skipped" in screening && screening.skipped,
      acquisition_recovered: acquisition.recovered,
      screening_error: screening.error,
      acquisition_error: acquisition.error,
    });
  } catch (error) {
    console.error("[ai-task-recovery] cron rescue failed", error);
    return NextResponse.json({ error: "AI_TASK_RECOVERY_FAILED" }, { status: 500 });
  }
}
