import { NextRequest, NextResponse } from "next/server";
import { rescueStalledCloudTasks } from "@/lib/ai/task-dispatch";
import { rescueStalledAiAcquisitionTasks } from "@/lib/ai-acquisition/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Recovery must not depend on a salesperson leaving the task-list page open.
// Vercel Cron sends this secret as a Bearer token on each production request.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const [screeningRecovered, acquisitionRecovered, expiredRefresh] = await Promise.all([
      rescueStalledCloudTasks(),
      rescueStalledAiAcquisitionTasks(),
      createAdminClient().rpc("refresh_expired_public_customers"),
    ]);
    if (expiredRefresh.error) console.warn("[ai-task-recovery] public-customer expiry refresh failed", expiredRefresh.error);
    return NextResponse.json({ ok: true, recovered: screeningRecovered + acquisitionRecovered, screening_recovered: screeningRecovered, acquisition_recovered: acquisitionRecovered, public_customer_expiry_refreshed: !expiredRefresh.error });
  } catch (error) {
    console.error("[ai-task-recovery] cron rescue failed", error);
    return NextResponse.json({ error: "AI_TASK_RECOVERY_FAILED" }, { status: 500 });
  }
}
