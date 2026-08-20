import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = params.get("to") || new Date().toISOString().slice(0, 10);
    const admin = createAdminClient();
    const result = await admin.from("ai_screening_tasks").select("id,name,task_number,total_count,processed_count,input_tokens,cached_input_tokens,output_tokens,total_tokens,total_cost_usd,created_at").eq("user_id", user.id).gte("created_at", `${from}T00:00:00`).lte("created_at", `${to}T23:59:59.999`).order("created_at", { ascending: false });
    if (result.error) throw result.error;
    const tasks = result.data || [];
    const totals = tasks.reduce((sum, item) => ({
      processed: sum.processed + Number(item.processed_count || 0),
      input: sum.input + Number(item.input_tokens || 0),
      cached: sum.cached + Number(item.cached_input_tokens || 0),
      output: sum.output + Number(item.output_tokens || 0),
      tokens: sum.tokens + Number(item.total_tokens || 0),
      cost: sum.cost + Number(item.total_cost_usd || 0),
    }), { processed: 0, input: 0, cached: 0, output: 0, tokens: 0, cost: 0 });
    const dailyMap = new Map<string, { date: string; tokens: number; cost: number }>();
    for (const item of tasks) {
      const date = String(item.created_at).slice(0, 10);
      const current = dailyMap.get(date) || { date, tokens: 0, cost: 0 };
      current.tokens += Number(item.total_tokens || 0);
      current.cost += Number(item.total_cost_usd || 0);
      dailyMap.set(date, current);
    }
    return NextResponse.json({ tasks, totals, daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI筛选用量查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

