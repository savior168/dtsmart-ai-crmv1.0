import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_DISPATCH_POLICIES, AI_DISPATCH_POLICY_LABELS, type AiDispatchPolicy } from "@/lib/ai/task-types";

export async function GET() {
  try {
    await requirePermission("ai.tasks.create");
    const admin = createAdminClient();
    const [settings, workers] = await Promise.all([
      admin.from("cost_center_settings").select("ai_default_dispatch_policy,updated_at").eq("id", true).single(),
      admin.from("ai_worker_nodes").select("status,last_heartbeat_at,metadata").eq("status", "ONLINE"),
    ]);
    if (settings.error) throw settings.error;
    if (workers.error) throw workers.error;
    const rawPolicy = settings.data.ai_default_dispatch_policy as AiDispatchPolicy;
    const policy = AI_DISPATCH_POLICIES.includes(rawPolicy) ? rawPolicy : "VERCEL_FIRST";
    const now = Date.now();
    const liveWorkers = (workers.data || []).filter((worker) => now - new Date(worker.last_heartbeat_at).getTime() <= 45_000);
    const verifiedWorkers = liveWorkers.filter((worker) => {
      const metadata = worker.metadata as Record<string, unknown> | null;
      return metadata?.analysis_ready === true;
    });
    return NextResponse.json({
      policy,
      label: AI_DISPATCH_POLICY_LABELS[policy],
      live_local_workers: liveWorkers.length,
      verified_local_workers: verifiedWorkers.length,
      updated_at: settings.data.updated_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "执行策略加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
