import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapCustomerForAi } from "@/lib/ai/semantic-fields";
import { getReservedAiCustomerIds } from "@/lib/ai/task-eligibility";

function sourcePattern(value: string) {
  const patterns: Record<string, string> = {
    "新增&导入": "EXCEL_IMPORT,MANUAL,IMPORT",
    "海关数据": "CUSTOMS,海关",
    "Google Map": "GOOGLE_MAPS,GOOGLE MAP",
    Facebook: "FACEBOOK",
    Instagram: "INSTAGRAM",
    LinkedIn: "LINKEDIN",
    其他: "OTHER",
  };
  return patterns[value] || value;
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(200, Math.max(10, Number(params.get("pageSize") || 20)));
    const search = params.get("search")?.trim() || "";
    const country = params.get("country")?.trim() || "";
    const sourceChannel = params.get("source_channel")?.trim() || "";
    const sourceBatch = params.get("source_batch")?.trim() || "";
    const from = params.get("date_from")?.trim() || "";
    const to = params.get("date_to")?.trim() || "";
    const idsOnly = params.get("ids") === "all";
    const admin = createAdminClient();

    const excluded = await getReservedAiCustomerIds(user.id);

    const normalizedSourcePatterns = sourcePattern(sourceChannel).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    const buildQuery = (start: number, end: number) => {
      let query = supabase.from("customers").select("*", { count: "exact" }).is("deleted_at", null).is("ai_score", null);
      if (from) query = query.gte("created_at", `${from}T00:00:00`);
      if (to) query = query.lte("created_at", `${to}T23:59:59.999`);
      return query.order("updated_at", { ascending: false }).order("created_at", { ascending: false }).range(start, end);
    };

    const matchesFilters = (row: ReturnType<typeof mapCustomerForAi>) => {
      const needle = search.toLowerCase();
      if (needle && ![row.company_name, row.contact_name, row.email, row.phone].some((value) => String(value || "").toLowerCase().includes(needle))) return false;
      if (country && !String(row.country || "").toLowerCase().includes(country.toLowerCase())) return false;
      if (normalizedSourcePatterns.length) {
        const sourceText = String(row.source || "").toLowerCase();
        if (!normalizedSourcePatterns.some((pattern) => sourceText.includes(pattern))) return false;
      }
      if (sourceBatch && !String(row.source_batch || "").toLowerCase().includes(sourceBatch.toLowerCase())) return false;
      return true;
    };

    if (idsOnly) {
      const ids: string[] = [];
      let total = 0;
      for (let offset = 0; ; offset += 1000) {
        const result = await buildQuery(offset, offset + 999);
        if (result.error) throw result.error;
        total = result.count || 0;
        for (const item of result.data || []) {
          const mapped = mapCustomerForAi(item as Record<string, unknown>);
          if (!excluded.has(mapped.id) && matchesFilters(mapped)) ids.push(mapped.id);
        }
        if (!result.data || result.data.length < 1000) break;
      }
      return NextResponse.json({ ids, count: ids.length, database_count: total });
    }

    // Fetch the complete filtered result before pagination so the count and
    // "select all results" semantics stay exact after active-task exclusion.
    const collected: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await buildQuery(offset, offset + 999);
      if (result.error) throw result.error;
      for (const item of result.data || []) {
        const mapped = mapCustomerForAi(item as Record<string, unknown>);
        if (!excluded.has(mapped.id) && matchesFilters(mapped)) collected.push(mapped as unknown as Record<string, unknown>);
      }
      if (!result.data || result.data.length < 1000) break;
    }
    const eligibleCount = collected.length;
    const start = (page - 1) * pageSize;
    const data = collected.slice(start, start + pageSize);

    const taskRows = await admin.from("import_tasks").select("id,filename,created_at").eq("created_by", user.id).order("created_at", { ascending: false }).limit(200);
    return NextResponse.json({ data, count: eligibleCount, page, pageSize, excluded_count: excluded.size, batches: taskRows.data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "待筛选客户查询失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录会话已失效，请重新登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
