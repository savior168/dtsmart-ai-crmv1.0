import { NextRequest, NextResponse } from "next/server";
import { rescueStalledCloudTasks } from "@/lib/ai/task-dispatch";
import { rescueStalledAiAcquisitionTasks } from "@/lib/ai-acquisition/dispatch";

export const maxDuration = 60;

// Recovery must not depend on a salesperson leaving the task-list page open.
// Vercel Cron sends this secret as a Bearer token on each production request.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const [screeningRecovered, acquisitionRecovered] = await Promise.all([rescueStalledCloudTasks(), rescueStalledAiAcquisitionTasks()]);
    return NextResponse.json({ ok: true, recovered: screeningRecovered + acquisitionRecovered, screening_recovered: screeningRecovered, acquisition_recovered: acquisitionRecovered });
  } catch (error) {
    console.error("[ai-task-recovery] cron rescue failed", error);
    return NextResponse.json({ error: "AI_TASK_RECOVERY_FAILED" }, { status: 500 });
  }
}
