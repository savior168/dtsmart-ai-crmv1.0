import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACQUISITION_INDUSTRY_TERMS, normalizeAcquisitionCountries } from "@/lib/ai-acquisition/config";
import { aiAcquisitionWorkflow } from "@/workflows/ai-acquisition";

function taskNumber(userId: string, requestKey: string) {
  const owner = userId.replaceAll("-", "").slice(0, 6).toUpperCase();
  const compact = requestKey.replaceAll("-", "").toUpperCase();
  return `LEAD-${owner}-${compact.slice(0, 10)}-${compact.slice(-6)}`;
}

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    const ownerId = await requestedOwnerId(request, account, "ai.acquisition.data_all");
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const status = request.nextUrl.searchParams.get("status") || "";
    const search = (request.nextUrl.searchParams.get("search")?.trim() || "").replace(/[%_,()]/g, " ");
    const costMode = request.nextUrl.searchParams.get("cost_mode") || "";
    const country = request.nextUrl.searchParams.get("country") || "";
    const industry = request.nextUrl.searchParams.get("industry") || "";
    const from = request.nextUrl.searchParams.get("from") || "";
    const to = request.nextUrl.searchParams.get("to") || "";
    let query = createAdminClient().from("ai_acquisition_tasks").select("*,owner:users!ai_acquisition_tasks_user_id_fkey(id,name,email)", { count: "exact" });
    if (ownerId) query = query.eq("user_id", ownerId);
    if (status) query = query.eq("status", status);
    if (["FREE_ONLY", "ADAPTIVE"].includes(costMode)) query = query.eq("cost_mode", costMode);
    if (country) query = query.contains("countries", [country]);
    if (industry) query = query.contains("industries", [industry]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00.000+08:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999+08:00`);
    if (search) query = query.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
    const result = await query.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    return NextResponse.json({ data: result.data || [], count: result.count || 0, can_create: hasPermission(account, "ai.acquisition.create"), can_control: hasPermission(account, "ai.acquisition.control"), can_view_evidence: hasPermission(account, "ai.acquisition.evidence.view"), can_view_usage: hasPermission(account, "ai.acquisition.usage.view"), show_owner: hasPermission(account, "ai.acquisition.data_all") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI获客任务加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requirePermission("ai.acquisition.create");
    const body = await request.json() as Record<string, unknown>;
    const name = String(body.name || "").trim().slice(0, 100);
    const allowedIndustries = new Set(Object.keys(ACQUISITION_INDUSTRY_TERMS));
    const industries = Array.isArray(body.industries)
      ? [...new Set(body.industries.map(String).map((value) => value.trim()).filter((value) => allowedIndustries.has(value)))].slice(0, 12)
      : allowedIndustries.has(String(body.industry || "").trim()) ? [String(body.industry).trim()] : [];
    const industry = industries.join("、");
    const countries = normalizeAcquisitionCountries(body.countries);
    const keywords = Array.isArray(body.keywords) ? [...new Set(body.keywords.map(String).map((value) => value.trim()).filter(Boolean))].slice(0, 8) : [];
    const excludedKeywords = Array.isArray(body.excluded_keywords) ? [...new Set(body.excluded_keywords.map(String).map((value) => value.trim()).filter(Boolean))].slice(0, 8) : [];
    const requestKey = String(body.request_key || "").trim();
    const targetCount = 500;
    const costMode = body.cost_mode === "ADAPTIVE" ? "ADAPTIVE" : "FREE_ONLY";
    const taskCostLimit = costMode === "FREE_ONLY" ? 0 : Number(body.task_cost_limit_usd);
    if (!name) return NextResponse.json({ error: "请输入任务名称" }, { status: 400 });
    if (!industries.length) return NextResponse.json({ error: "请至少选择一个目标行业" }, { status: 400 });
    if (!countries.length || countries.length > 8) return NextResponse.json({ error: "请选择1至8个已支持的目标国家" }, { status: 400 });
    if (excludedKeywords.some((value) => value.length < 3)) return NextResponse.json({ error: "排除关键词每项至少需要3个字符，避免误排正常企业" }, { status: 400 });
    if (!/^[0-9a-f-]{36}$/i.test(requestKey)) return NextResponse.json({ error: "任务请求标识无效，请刷新后重试" }, { status: 400 });
    if (costMode === "ADAPTIVE" && (!Number.isFinite(taskCostLimit) || taskCostLimit <= 0)) return NextResponse.json({ error: "智能增强模式必须设置大于0的单任务费用上限" }, { status: 400 });
    const admin = createAdminClient();
    const number = taskNumber(user.id, requestKey);
    const existing = await admin.from("ai_acquisition_tasks").select("*").eq("task_number", number).eq("user_id", user.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return NextResponse.json({ task: existing.data, reused: true });
    const task = await admin.from("ai_acquisition_tasks").insert({ user_id: user.id, task_number: number, name, cost_mode: costMode, countries, industry, industries, keywords, excluded_keywords: excludedKeywords, target_count: targetCount, task_cost_limit_usd: taskCostLimit }).select("*").single();
    if (task.error?.code === "23505") {
      const repeated = await admin.from("ai_acquisition_tasks").select("*").eq("task_number", number).eq("user_id", user.id).single();
      if (!repeated.error && repeated.data) return NextResponse.json({ task: repeated.data, reused: true });
    }
    if (task.error || !task.data) throw task.error || new Error("AI获客任务创建失败");
    try {
      const run = await start(aiAcquisitionWorkflow, [task.data.id]);
      const updated = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", last_dispatch_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", task.data.id).select("*").single();
      if (updated.error) throw updated.error;
      await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_ACQUISITION_TASK_CREATE", target_type: "ai_acquisition_task", target_id: task.data.id, content: { task_number: task.data.task_number, cost_mode: costMode, countries, industries, keywords, search_policy: "ALL_QUALIFIED_WITHIN_SUPPORTED_SOURCES", task_cost_limit_usd: taskCostLimit } });
      return NextResponse.json({ task: updated.data }, { status: 201 });
    } catch (dispatchError) {
      await admin.from("ai_acquisition_tasks").update({ status: "FAILED", error_message: dispatchError instanceof Error ? dispatchError.message : "云端任务启动失败", updated_at: new Date().toISOString() }).eq("id", task.data.id);
      throw dispatchError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI获客任务创建失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
