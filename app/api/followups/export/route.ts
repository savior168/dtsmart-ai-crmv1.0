import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { CUSTOMER_STATUS_LABELS, FOLLOWUP_TYPE_LABELS } from "@/lib/types";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

type FollowupRow = {
  type: string;
  content: string;
  next_follow_date: string | null;
  created_at: string;
  user: { name?: string | null; email?: string | null } | Array<{ name?: string | null; email?: string | null }> | null;
  customer: { company_name?: string; country?: string | null; ai_level?: string | null; ai_score?: number | null; status?: string } | Array<{ company_name?: string; country?: string | null; ai_level?: string | null; ai_score?: number | null; status?: string }> | null;
};

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("followups.export");
    const params = request.nextUrl.searchParams;
    const scope = params.get("scope") || "history";
    const search = params.get("q")?.trim() || "";
    const scopeUserId = requestedOwnerId(request, account, "followups.data_all");
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const rows: FollowupRow[] = [];

    for (let offset = 0; offset < 100000; offset += 1000) {
      let query = supabase.from("followups")
        .select("type,content,next_follow_date,created_at,user:users!followups_user_id_fkey(name,email),customer:customers!inner(company_name,country,ai_level,ai_score,status)")
        .order(scope === "history" ? "created_at" : "next_follow_date", { ascending: scope !== "history", nullsFirst: false })
        .range(offset, offset + 999);
      if (scopeUserId) query = query.eq("user_id", scopeUserId);
      if (search) query = query.ilike("customer.company_name", `%${search.replace(/[%_]/g, "\\$&")}%`);
      if (scope === "overdue") query = query.lt("next_follow_date", start.toISOString());
      else if (scope === "upcoming") query = query.gte("next_follow_date", start.toISOString());
      else if (scope === "today") query = query.gte("next_follow_date", start.toISOString()).lt("next_follow_date", end.toISOString());
      const page = await query;
      if (page.error) throw page.error;
      rows.push(...((page.data || []) as FollowupRow[]));
      if ((page.data || []).length < 1000) break;
    }

    const headings = ["客户名称", "国家/地区", "AI等级", "AI评分", "客户阶段", "跟进方式", "跟进内容", "计划跟进时间", "记录时间", "归属人"];
    const lines = rows.map((row) => {
      const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
      const owner = Array.isArray(row.user) ? row.user[0] : row.user;
      return [
        customer?.company_name, customer?.country, customer?.ai_level, customer?.ai_score,
        CUSTOMER_STATUS_LABELS[customer?.status as keyof typeof CUSTOMER_STATUS_LABELS] || customer?.status,
        FOLLOWUP_TYPE_LABELS[row.type as keyof typeof FOLLOWUP_TYPE_LABELS] || row.type,
        row.content,
        row.next_follow_date ? new Date(row.next_follow_date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "",
        new Date(row.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
        owner?.name || owner?.email,
      ].map(csvCell).join(",");
    });
    const csv = `\uFEFF${headings.map(csvCell).join(",")}\r\n${lines.join("\r\n")}`;
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`跟进记录_${new Date().toISOString().slice(0, 10)}.csv`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "跟进记录导出失败" }, { status: 400 });
  }
}
