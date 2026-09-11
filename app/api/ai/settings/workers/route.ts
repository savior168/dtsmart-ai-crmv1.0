import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    await requirePermission("ai.settings.manage");
    const admin=createAdminClient();
    const workers=await admin.from("ai_worker_nodes").select("worker_id,display_name,host_name,worker_version,status,concurrency,active_count,last_heartbeat_at,started_at,metadata").order("last_heartbeat_at",{ascending:false});
    if(workers.error) throw workers.error;
    const now=Date.now();
    return NextResponse.json({workers:(workers.data||[]).map(worker=>({
      ...worker,
      healthy:worker.status==="ONLINE"&&now-new Date(worker.last_heartbeat_at).getTime()<=45_000&&(worker.metadata as Record<string,unknown>|null)?.analysis_ready===true,
    }))});
  } catch(error) {
    const message=error instanceof Error?error.message:"本地执行器状态加载失败";
    return NextResponse.json({error:message},{status:authErrorStatus(message)||400});
  }
}
