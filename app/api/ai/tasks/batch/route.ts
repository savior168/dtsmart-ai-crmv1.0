import { NextRequest,NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const ARCHIVABLE_STATUSES=["COMPLETED","CANCELLED","FAILED"] as const;

export async function PATCH(request:NextRequest) {
  try {
    const {user,account}=await requirePermission("ai.tasks.delete");
    const body=await request.json() as {action?:string;task_ids?:string[]};
    if(body.action!=="archive") return NextResponse.json({error:"不支持的批量操作"},{status:400});
    const taskIds=[...new Set((body.task_ids||[]).map(String).filter(Boolean))].slice(0,100);
    if(!taskIds.length) return NextResponse.json({error:"请选择要归档的任务"},{status:400});
    const admin=createAdminClient();
    let query=admin.from("ai_screening_tasks").select("id,user_id,status,task_number").in("id",taskIds).is("archived_at",null);
    if(account.role!=="ADMIN") query=query.eq("user_id",user.id);
    const tasks=await query;
    if(tasks.error) throw tasks.error;
    if((tasks.data||[]).length!==taskIds.length) return NextResponse.json({error:"所选任务中包含不存在、已归档或无权操作的数据，整批未执行"},{status:403});
    const invalid=(tasks.data||[]).filter(task=>!ARCHIVABLE_STATUSES.includes(task.status as typeof ARCHIVABLE_STATUSES[number]));
    if(invalid.length) return NextResponse.json({error:`有 ${invalid.length} 个任务仍在活动或暂停状态，整批未执行`},{status:409});
    const archived=await admin.rpc("archive_ai_screening_tasks",{p_task_ids:taskIds,p_actor_id:user.id,p_is_admin:account.role==="ADMIN"});
    if(archived.error) throw archived.error;
    await admin.from("audit_logs").insert({user_id:user.id,action:"AI_TASK_BATCH_ARCHIVE",target_type:"ai_screening_task",target_id:null,content:{task_ids:taskIds,task_numbers:(tasks.data||[]).map(task=>task.task_number),count:taskIds.length,result:"任务已归档；客户结果、证据及费用账本保留"}});
    return NextResponse.json({success:true,archived_count:Number(archived.data||0)});
  } catch(error) {
    const message=error instanceof Error?error.message:"批量归档失败";
    return NextResponse.json({error:message},{status:authErrorStatus(message)||400});
  }
}
