import { NextRequest, NextResponse } from "next/server";
import { rescueStalledCloudTasks } from "@/lib/ai/task-dispatch";
import { rescueStalledAiAcquisitionTasks } from "@/lib/ai-acquisition/dispatch";

export const maxDuration = 60;

const RECOVERY_DEADLINE_MS = 12_000;

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
