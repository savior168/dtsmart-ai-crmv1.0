import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapCustomerForAi } from "@/lib/ai/semantic-fields";
import { getReservedAiCustomerIds } from "@/lib/ai/task-eligibility";

type MappedCustomer = ReturnType<typeof mapCustomerForAi>;

function sourceKind(row: MappedCustomer) {
  const source = `${row.source_channel || ""} ${row.source || ""}`.toLowerCase();
  if (row.source_batch_id || row.source_batch || /(batch_import|excel_import|\bimport\b|批量导入|新增&导入)/i.test(source)) return "BATCH_IMPORT";
  if (/(manual_create|\bmanual\b|手动新增)/i.test(source) || (!row.source_channel && !row.source_batch)) return "MANUAL";
  if (/(customs|海关)/i.test(source)) return "海关数据";
  if (/(google[_ ]?maps?)/i.test(source)) return "Google Map";
  if (/facebook/i.test(source)) return "Facebook";
  if (/instagram/i.test(source)) return "Instagram";
  if (/linkedin/i.test(source)) return "LinkedIn";
  return "其他";
}

function batchFilterKey(row: MappedCustomer) {
  return row.source_batch_id || (row.source_batch ? `legacy:${row.source_batch}` : "");
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requirePermission("ai.tasks.create");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(200, Math.max(10, Number(params.get("pageSize") || 20)));
    const search = params.get("search")?.trim() || "";
    const country = params.get("country")?.trim() || "";
    const sourceChannel = params.get("source_channel")?.trim() || "";
    const sourceBatches = params.getAll("source_batch").map((value) => value.trim()).filter(Boolean);
    const from = params.get("date_from")?.trim() || "";
    const to = params.get("date_to")?.trim() || "";
    const idsOnly = params.get("ids") === "all";
    const admin = createAdminClient();

    const excluded = await getReservedAiCustomerIds(user.id);

    const buildQuery = (start: number, end: number) => {
      const query = supabase.from("customers").select("*", { count: "exact" }).eq("owner_id", user.id).is("deleted_at", null).is("ai_score", null);
      return query.order("updated_at", { ascending: false }).order("created_at", { ascending: false }).range(start, end);
    };

    const matchesFilters = (row: ReturnType<typeof mapCustomerForAi>) => {
      const needle = search.toLowerCase();
      if (needle && ![row.company_name, row.contact_name, row.email, row.phone].some((value) => String(value || "").toLowerCase().includes(needle))) return false;
      if (country && !String(row.country || "").toLowerCase().includes(country.toLowerCase())) return false;
      if (sourceChannel && sourceKind(row) !== sourceChannel) return false;
      if (sourceBatches.length && !sourceBatches.includes(batchFilterKey(row))) return false;
      if (from && String(row.created_at || "") < `${from}T00:00:00`) return false;
      if (to && String(row.created_at || "") > `${to}T23:59:59.999`) return false;
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
    const eligible: MappedCustomer[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await buildQuery(offset, offset + 999);
      if (result.error) throw result.error;
      for (const item of result.data || []) {
        const mapped = mapCustomerForAi(item as Record<string, unknown>);
        if (!excluded.has(mapped.id)) eligible.push(mapped);
      }
      if (!result.data || result.data.length < 1000) break;
    }
    const collected = eligible.filter(matchesFilters) as unknown as Array<Record<string, unknown>>;
    const eligibleCount = collected.length;
    const start = (page - 1) * pageSize;
    const data = collected.slice(start, start + pageSize);

    const batchCounts = new Map<string, { id: string; filename: string; pending_count: number; success_count: number | null; created_at: string | null; legacy: boolean }>();
    for (const item of eligible) {
      if (sourceKind(item) !== "BATCH_IMPORT" || !item.source_batch) continue;
      const id = batchFilterKey(item);
      if (!id) continue;
      const current = batchCounts.get(id);
      batchCounts.set(id, {
        id,
        filename: item.source_batch,
        pending_count: (current?.pending_count || 0) + 1,
        success_count: current?.success_count ?? null,
        created_at: current?.created_at || item.created_at || null,
        legacy: !item.source_batch_id,
      });
    }
    const taskIds = [...batchCounts.values()].filter((item) => !item.legacy).map((item) => item.id);
    if (taskIds.length) {
      for (let offset = 0; offset < taskIds.length; offset += 200) {
        const taskRows = await admin.from("import_tasks").select("id,filename,success_count,created_at").eq("created_by", user.id).gt("success_count", 0).in("id", taskIds.slice(offset, offset + 200));
        if (taskRows.error) throw taskRows.error;
        for (const task of taskRows.data || []) {
          const current = batchCounts.get(task.id);
          if (current) batchCounts.set(task.id, { ...current, filename: task.filename || current.filename, success_count: task.success_count ?? current.success_count, created_at: task.created_at || current.created_at });
        }
      }
    }
    const batches = [...batchCounts.values()]
      // 历史客户可能只有导入文件名、尚未回填 import_task_id。只要该批次
      // 仍有当前用户可筛选的客户，就必须作为可选批次返回，不能静默隐藏。
      .filter((item) => item.pending_count > 0)
      .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    return NextResponse.json({ data, count: eligibleCount, page, pageSize, excluded_count: excluded.size, batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "待筛选客户查询失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录会话已失效，请重新登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
