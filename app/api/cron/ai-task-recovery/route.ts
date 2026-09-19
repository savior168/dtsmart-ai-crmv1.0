import { NextRequest, NextResponse } from "next/server";
import { rescueStalledCloudTasks } from "@/lib/ai/task-dispatch";
import { rescueStalledAiAcquisitionTasks } from "@/lib/ai-acquisition/dispatch";

export const maxDuration = 60;

const RECOVERY_DEADLINE_MS = 12_000;

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
  // During an incident the exact protected IDs have already had their durable
  // Workflow runs cancelled. Do not keep polling or writing the saturated
  // database from a per-minute cron; manual resume is the only exit path.
  if (maintenancePaused.acquisition || maintenancePaused.screening) {
    return NextResponse.json({ ok: true, maintenance_mode: true, maintenance_paused: maintenancePaused });
  }
  try {
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
    });
  } catch (error) {
    console.error("[ai-task-recovery] cron rescue failed", error);
    return NextResponse.json({ error: "AI_TASK_RECOVERY_FAILED" }, { status: 500 });
  }
}
