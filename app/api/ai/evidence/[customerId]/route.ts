import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ customerId: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { customerId } = await context.params;
    const visible = await supabase.from("customers").select("id,company_name,contact_name,country,phone,email,website,google_url,website_email,website_phone,ai_score,ai_level,ai_reason,business_relevance,customer_value,followup_suggestion").eq("id", customerId).single();
    if (visible.error || !visible.data) throw visible.error || new Error("客户不存在或无权访问");
    const admin = createAdminClient();
    const requestedTaskId = request.nextUrl.searchParams.get("task")?.trim() || "";
    let resultQuery = admin.from("ai_screening_results").select("*,task:ai_screening_tasks(id,name,task_number,user_id)").eq("customer_id", customerId);
    if (requestedTaskId) resultQuery = resultQuery.eq("task_id", requestedTaskId);
    const result = await resultQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw result.error;
    const task = result.data ? (Array.isArray(result.data.task) ? result.data.task[0] : result.data.task) : null;
    if (task && task.user_id !== user.id) throw new Error("无权查看该客户的AI分析依据");
    const evidence = result.data ? await admin.from("ai_screening_evidence").select("*").eq("result_id", result.data.id).order("fetched_at", { ascending: true }) : { data: [], error: null };
    if (evidence.error) throw evidence.error;
    return NextResponse.json({ customer: visible.data, result: result.data || null, evidence: evidence.data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI分析依据查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
