import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, FOLLOWUP_TYPE_LABELS } from "@/lib/types";
import { workbookResponse } from "@/lib/xlsx-export";
import { followupDayBounds } from "@/lib/customers/followup-day";
import { countryFilterRawValues } from "@/lib/countries";
import { createAdminClient } from "@/lib/supabase/admin";

type FollowupRow = {
  type: string | null;
  content: string | null;
  next_follow_date: string | null;
  created_at: string | null;
  company_name: string;
  country: string | null;
  ai_level: string | null;
  ai_score: number | null;
  status: string;
  owner_name?: string | null;
  owner_email?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("followups.export");
    const params = request.nextUrl.searchParams;
    const scope = params.get("scope") || "history";
    if (!["today", "overdue", "upcoming", "unscheduled", "history"].includes(scope)) return NextResponse.json({ error: "无效的跟进范围" }, { status: 400 });
    const search = params.get("q")?.trim().replace(/[%_,()]/g, "") || "";
    const stage = params.get("stage")?.trim() || "";
    if (stage && !new Set<string>(CUSTOMER_STATUSES).has(stage)) return NextResponse.json({ error: "无效的客户阶段" }, { status: 400 });
    const countries = [...new Set(params.getAll("country").map((item) => item.trim()).filter(Boolean))];
    const scopeUserId = await requestedOwnerId(request, account, "followups.data_all");
    const followupReader = createAdminClient();
    const { start, end } = followupDayBounds();
    const rows: FollowupRow[] = [];

    for (let offset = 0; offset <= 100000; offset += 1000) {
      let page;
      if (scope === "history") {
        let query = followupReader.from("customer_followup_history")
          .select("type,content,next_follow_date,created_at,company_name,country,ai_level,ai_score,status,actor_name,actor_email");
        if (scopeUserId) query = query.eq("owner_id", scopeUserId);
        if (stage) query = query.eq("status", stage);
        if (countries.length) query = query.in("country", countryFilterRawValues(countries));
        if (search) query = query.or(`content.ilike.%${search}%,company_name.ilike.%${search}%,contact_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
        page = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 999);
      } else {
        let query = followupReader.from("customer_followup_queue")
          .select("type,content,next_follow_date,created_at,company_name,country,ai_level,ai_score,status,owner_name,owner_email");
        if (scopeUserId) query = query.eq("owner_id", scopeUserId);
        if (stage) query = query.eq("status", stage);
        if (countries.length) query = query.in("country", countryFilterRawValues(countries));
        if (search) query = query.or(`content.ilike.%${search}%,company_name.ilike.%${search}%,contact_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
        if (scope === "today") query = query.gte("next_follow_date", start).lt("next_follow_date", end);
        if (scope === "overdue") query = query.lt("next_follow_date", start);
        if (scope === "upcoming") query = query.gte("next_follow_date", end);
        if (scope === "unscheduled") query = query.is("next_follow_date", null);
        page = await query.order(scope === "unscheduled" ? "company_name" : "next_follow_date", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 999);
      }
      if (page.error) throw page.error;
      rows.push(...((page.data || []) as FollowupRow[]));
      if (rows.length > 100000) throw new Error("导出超过 10 万条，请缩小筛选范围后重试");
      if ((page.data || []).length < 1000) break;
    }

    const headings = ["客户名称", "国家/地区", "AI等级", "AI评分", "客户阶段", "跟进方式", "跟进内容", "计划跟进时间", "记录时间", scope === "history" ? "记录人" : "当前归属"];
    const lines = rows.map((row) => {
      return [
        row.company_name, row.country, row.ai_level, row.ai_score,
        CUSTOMER_STATUS_LABELS[row.status as keyof typeof CUSTOMER_STATUS_LABELS] || row.status,
        row.type ? FOLLOWUP_TYPE_LABELS[row.type as keyof typeof FOLLOWUP_TYPE_LABELS] || row.type : "",
        row.content || "",
        row.next_follow_date ? new Date(row.next_follow_date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "",
        row.created_at ? new Date(row.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "",
        scope === "history" ? row.actor_name || row.actor_email : row.owner_name || row.owner_email,
      ];
    });
    return workbookResponse(`跟进记录_${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: "跟进记录", rows: [headings, ...lines], widths: [26, 16, 10, 10, 16, 16, 52, 20, 20, 18], wrapColumns: [6] }]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "跟进记录导出失败" }, { status: 400 });
  }
}
