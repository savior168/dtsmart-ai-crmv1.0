import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

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

    const activeTasks = await admin.from("ai_screening_tasks").select("id").eq("user_id", user.id).in("status", ["QUEUED", "RUNNING", "PAUSED"]);
    const taskIds = (activeTasks.data || []).map((item) => item.id);
    const excluded = new Set<string>();
    for (let offset = 0; taskIds.length; offset += 1000) {
      const items = await admin.from("ai_screening_task_items").select("customer_id").in("task_id", taskIds).in("status", ["PENDING", "RUNNING"]).range(offset, offset + 999);
      for (const item of items.data || []) excluded.add(item.customer_id);
      if (!items.data || items.data.length < 1000) break;
    }

    const select = "id,company_name,contact_name,country,phone,email,website,google_url,source,source_channel,source_batch,created_at";
    const buildQuery = (start: number, end: number) => {
      let query = supabase.from("customers").select(select, { count: "exact" }).is("deleted_at", null).is("ai_score", null);
      if (search) query = query.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
      if (country) query = query.ilike("country", `%${country}%`);
      if (sourceChannel) {
        const values = sourcePattern(sourceChannel).split(",").map((value) => `source.ilike.%${value}%`);
        query = query.or(values.join(","));
      }
      if (sourceBatch) query = query.ilike("source_batch", `%${sourceBatch}%`);
      if (from) query = query.gte("created_at", `${from}T00:00:00`);
      if (to) query = query.lte("created_at", `${to}T23:59:59.999`);
      return query.order("created_at", { ascending: false }).range(start, end);
    };

    if (idsOnly) {
      const ids: string[] = [];
      let total = 0;
      for (let offset = 0; ; offset += 1000) {
        const result = await buildQuery(offset, offset + 999);
        if (result.error) throw result.error;
        total = result.count || 0;
        for (const item of result.data || []) if (!excluded.has(item.id)) ids.push(item.id);
        if (!result.data || result.data.length < 1000) break;
      }
      return NextResponse.json({ ids, count: ids.length, database_count: total });
    }

    // Fetch enough rows to compensate for customers already reserved by active tasks.
    const collected: Array<Record<string, unknown>> = [];
    let databaseCount = 0;
    for (let offset = 0; collected.length < page * pageSize; offset += 1000) {
      const result = await buildQuery(offset, offset + 999);
      if (result.error) throw result.error;
      databaseCount = result.count || 0;
      for (const item of result.data || []) if (!excluded.has(item.id)) collected.push(item);
      if (!result.data || result.data.length < 1000) break;
    }
    const eligibleCount = Math.max(0, databaseCount - excluded.size);
    const start = (page - 1) * pageSize;
    const data = collected.slice(start, start + pageSize);

    const taskRows = await admin.from("import_tasks").select("id,filename,created_at").eq("created_by", user.id).order("created_at", { ascending: false }).limit(200);
    return NextResponse.json({ data, count: eligibleCount, page, pageSize, excluded_count: excluded.size, batches: taskRows.data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "待筛选客户查询失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录会话已失效，请重新登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

