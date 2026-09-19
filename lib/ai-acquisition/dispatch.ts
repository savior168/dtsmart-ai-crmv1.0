import { start } from "workflow/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiAcquisitionWorkflow } from "@/workflows/ai-acquisition";

function maintenancePausedTaskIds() {
  return new Set(
    (process.env.AI_MAINTENANCE_PAUSED_ACQUISITION_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[0-9a-f-]{36}$/i.test(value)),
  );
}

async function reconcileCompletedAcquisitionTask(admin: ReturnType<typeof createAdminClient>, taskId: string) {
  const child = await admin.from("ai_screening_tasks").select("id,status").eq("request_key", `acquisition:${taskId}`).maybeSingle();
  if (child.error) throw child.error;
  if (child.data?.status !== "COMPLETED") return false;
  const analyzing = await admin.from("ai_acquisition_candidates").select("id", { count: "exact", head: true }).eq("task_id", taskId).eq("decision", "ANALYZING");
  if (analyzing.error) throw analyzing.error;
  if (Number(analyzing.count || 0) > 0) return false;
  const count = async (decision: string) => {
    const result = await admin.from("ai_acquisition_candidates").select("id", { count: "exact", head: true }).eq("task_id", taskId).eq("decision", decision);
    if (result.error) throw result.error;
    return Number(result.count || 0);
  };
  const [accepted, review, rejected, duplicate] = await Promise.all([count("ACCEPTED"), count("REVIEW"), count("REJECTED"), count("DUPLICATE")]);
  const now = new Date().toISOString();
  const saved = await admin.from("ai_acquisition_tasks").update({
    status: "COMPLETED", current_stage: "FINISHED", current_stage_detail: "候选发现、核验、去重和准入判定均已完成",
    processed_count: accepted + review + rejected + duplicate, accepted_count: accepted, review_count: review,
    rejected_count: rejected, duplicate_count: duplicate, started_at: null, finished_at: now,
    active_executor: null, executor_heartbeat_at: now, error_message: null, updated_at: now,
  }).eq("id", taskId).eq("active_executor", "VERCEL_DISPATCHING");
  if (saved.error) throw saved.error;
  return true;
}

export async function rescueStalledAiAcquisitionTasks(signal?: AbortSignal) {
  const admin = createAdminClient();
  const maintenancePausedIds = maintenancePausedTaskIds();
  const claimed = await admin.rpc("claim_stalled_ai_acquisition_tasks", { p_limit: 1 }).abortSignal(signal || new AbortController().signal);
  if (claimed.error) throw claimed.error;
  let recovered = 0;
  for (const row of claimed.data || []) {
    const taskId = String(row.task_id || "");
    if (!taskId) continue;
    try {
      const state = await admin.from("ai_acquisition_tasks").select("status,cancel_requested").eq("id", taskId).single();
      if (state.error) throw state.error;
      if (maintenancePausedIds.has(taskId) || state.data.status === "PAUSING" || state.data.cancel_requested) {
        await admin.from("ai_acquisition_tasks").update({ status: state.data.cancel_requested ? "CANCELLED" : "PAUSED", active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: new Date().toISOString() }).eq("id", taskId);
        continue;
      }
      if (await reconcileCompletedAcquisitionTask(admin, taskId)) {
        recovered += 1;
        continue;
      }
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
