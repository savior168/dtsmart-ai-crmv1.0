import { start } from "workflow/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiAcquisitionWorkflow } from "@/workflows/ai-acquisition";

export async function rescueStalledAiAcquisitionTasks() {
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_stalled_ai_acquisition_tasks", { p_limit: 3 });
  if (claimed.error) throw claimed.error;
  let recovered = 0;
  for (const row of claimed.data || []) {
    const taskId = String(row.task_id || "");
    if (!taskId) continue;
    try {
      const run = await start(aiAcquisitionWorkflow, [taskId]);
      const saved = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", last_dispatch_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() }).eq("id", taskId).eq("active_executor", "VERCEL_DISPATCHING");
      if (saved.error) throw saved.error;
      recovered += 1;
    } catch (error) {
      await admin.from("ai_acquisition_tasks").update({ active_executor: null, error_message: (error instanceof Error ? error.message : "获客任务恢复失败").slice(0,1000), updated_at: new Date().toISOString() }).eq("id", taskId).eq("active_executor", "VERCEL_DISPATCHING");
    }
  }
  return recovered;
}
