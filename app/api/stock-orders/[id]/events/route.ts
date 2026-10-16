import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("stock.view");
    const { id } = await context.params;
    const rawPage = Number(request.nextUrl.searchParams.get("page") || 1);
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const order = await supabase.from("stock_orders").select("id").eq("id", id).maybeSingle();
    if (order.error) throw order.error;
    if (!order.data) return NextResponse.json({ error: "备货单不存在或您无权查看" }, { status: 404 });
    const result = await supabase.from("stock_order_events")
      .select("id,from_status,to_status,note,created_by,created_at", { count: "exact" })
      .eq("stock_order_id", id).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range((page - 1) * 10, page * 10 - 1);
    if (result.error) throw result.error;
    const actorIds = [...new Set((result.data || []).map((event) => event.created_by).filter(Boolean))];
    const actorResult = actorIds.length
      ? await createAdminClient().from("users").select("id,name,email").in("id", actorIds)
      : { data: [], error: null };
    if (actorResult.error) throw actorResult.error;
    const actors = new Map((actorResult.data || []).map((actor) => [actor.id, actor]));
    return NextResponse.json({ data: (result.data || []).map((event) => ({ ...event, creator: actors.get(event.created_by) || null })),
      count: result.count || 0, page, page_size: 10 });
  } catch (error) {
    const message = sqlErrorMessage(error, "状态流转记录加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
