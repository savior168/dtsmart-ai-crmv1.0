import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapCustomerForAi } from "@/lib/ai/semantic-fields";
import { getReservedAiCustomerIds } from "@/lib/ai/task-eligibility";
import { resolveAiOwnerScope } from "@/lib/ai/owner-scope";

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
    const { account } = await requirePermission("ai.tasks.create");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(200, Math.max(10, Number(params.get("pageSize") || 20)));
    const search = params.get("search")?.trim() || "";
    const sourceChannel = params.get("source_channel")?.trim() || "";
    const sourceBatches = params.getAll("source_batch").map((value) => value.trim()).filter(Boolean);
    const screeningTaskIds = params.getAll("screening_task_id").map((value) => value.trim()).filter(Boolean);
    const from = params.get("date_from")?.trim() || "";
    const to = params.get("date_to")?.trim() || "";
    const idsOnly = params.get("ids") === "all";
    const reverify = params.get("analysis_selection_mode") === "REVERIFY";
    const admin = createAdminClient();
    const ownerScope = await resolveAiOwnerScope(account, params.get("owner_id"));
    const excluded = await getReservedAiCustomerIds();

    const buildQuery = (start: number, end: number) => {
      let query = admin.from("customers").select("*", { count: "exact" }).is("deleted_at", null);
      // First analysis and re-verification are deliberately mutually exclusive.
      // This avoids silently mixing new customers with historical conclusions.
      query = reverify ? query.not("ai_score", "is", null) : query.is("ai_score", null);
      if (ownerScope.ownerIds) query = query.in("owner_id", ownerScope.ownerIds);
      return query.order("updated_at", { ascending: false }).order("created_at", { ascending: false }).range(start, end);
    };

    const matchesFilters = (row: ReturnType<typeof mapCustomerForAi>, tasksByCustomer: ReadonlyMap<string, ReadonlySet<string>>) => {
      const needle = search.toLowerCase();
      if (needle && ![row.company_name, row.contact_name, row.email, row.phone, row.country].some((value) => String(value || "").toLowerCase().includes(needle))) return false;
      if (sourceChannel && sourceKind(row) !== sourceChannel) return false;
      if (sourceBatches.length && !sourceBatches.includes(batchFilterKey(row))) return false;
      if (screeningTaskIds.length && !screeningTaskIds.some((taskId) => tasksByCustomer.get(row.id)?.has(taskId))) return false;
      if (from && String(row.created_at || "") < `${from}T00:00:00`) return false;
      if (to && String(row.created_at || "") > `${to}T23:59:59.999`) return false;
      return true;
    };

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
    const customerIdsForTasks = eligible.map((item) => item.id);
    const taskIdsByCustomer = new Map<string, Set<string>>();
    const taskIds = new Set<string>();
    if (reverify && customerIdsForTasks.length) {
      for (let offset = 0; offset < customerIdsForTasks.length; offset += 500) {
        const result = await admin.from("ai_screening_results")
          .select("customer_id,task_id")
          .in("customer_id", customerIdsForTasks.slice(offset, offset + 500))
          .eq("writeback_status", "COMPLETED");
        if (result.error) throw result.error;
        for (const row of result.data || []) {
          const customerId = String(row.customer_id || "");
          const taskId = String(row.task_id || "");
          if (!customerId || !taskId) continue;
          taskIds.add(taskId);
          const current = taskIdsByCustomer.get(customerId) || new Set<string>();
          current.add(taskId);
          taskIdsByCustomer.set(customerId, current);
        }
      }
    }
    const taskOptionsResult = taskIds.size
      ? await admin.from("ai_screening_tasks").select("id,name,task_number,created_at").in("id", [...taskIds]).order("created_at", { ascending: false })
      : { data: [], error: null };
    if (taskOptionsResult.error) throw taskOptionsResult.error;

    if (idsOnly) {
      const ids: string[] = [];
      for (const item of eligible) if (matchesFilters(item, taskIdsByCustomer)) ids.push(item.id);
      return NextResponse.json({ ids, count: ids.length, database_count: eligible.length });
    }

    // Fetch the complete filtered result before pagination so the count and
    // "select all results" semantics stay exact after active-task exclusion.
    const collected = eligible.filter((item) => matchesFilters(item, taskIdsByCustomer)) as unknown as Array<Record<string, unknown>>;
    const eligibleCount = collected.length;
    const start = (page - 1) * pageSize;
    const data = collected.slice(start, start + pageSize);
    const sourceCounts = new Map<string, number>();
    for (const item of eligible) {
      const kind = sourceKind(item);
      sourceCounts.set(kind, (sourceCounts.get(kind) || 0) + 1);
    }

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
    const importTaskIds = [...batchCounts.values()].filter((item) => !item.legacy).map((item) => item.id);
    if (importTaskIds.length) {
      for (let offset = 0; offset < importTaskIds.length; offset += 200) {
        let taskQuery = admin.from("import_tasks").select("id,filename,success_count,created_at").gt("success_count", 0).in("id", importTaskIds.slice(offset, offset + 200));
        if (ownerScope.ownerIds) taskQuery = taskQuery.in("created_by", ownerScope.ownerIds);
        const taskRows = await taskQuery;
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
    const ownerIds = ownerScope.canSelectOwner ? [...new Set(data.map((item) => String(item.owner_id || "")).filter(Boolean))] : [];
    const customerIds = data.map((item) => String(item.id));
    const [ownerRows, resultRows] = await Promise.all([
      ownerIds.length ? admin.from("users").select("id,name,email").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
      reverify && customerIds.length
        ? admin.from("ai_screening_results").select("customer_id,completed_at,analysis_version,created_at").in("customer_id", customerIds).eq("writeback_status", "COMPLETED").order("completed_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (ownerRows.error) throw ownerRows.error;
    if (resultRows.error) throw resultRows.error;
    const ownerById = new Map((ownerRows.data || []).map((item) => [item.id, item]));
    const analysisByCustomer = new Map<string, { completed_analysis_count: number; latest_analysis_at: string | null; latest_analysis_version: string | null }>();
    for (const result of resultRows.data || []) {
      const customerId = String(result.customer_id || "");
      if (!customerId) continue;
      const current = analysisByCustomer.get(customerId);
      analysisByCustomer.set(customerId, {
        completed_analysis_count: (current?.completed_analysis_count || 0) + 1,
        latest_analysis_at: current?.latest_analysis_at || result.completed_at || result.created_at || null,
        latest_analysis_version: current?.latest_analysis_version || result.analysis_version || null,
      });
    }
    const taskCounts = new Map<string, number>();
    for (const item of eligible) for (const taskId of taskIdsByCustomer.get(item.id) || []) taskCounts.set(taskId, (taskCounts.get(taskId) || 0) + 1);
    return NextResponse.json({ data: data.map((item) => ({ ...item, owner: item.owner_id ? ownerById.get(String(item.owner_id)) || null : null, ...(analysisByCustomer.get(String(item.id)) || {}) })), count: eligibleCount, page, pageSize, excluded_count: excluded.size, batches, source_options: [...sourceCounts.entries()].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count), screening_tasks: (taskOptionsResult.data || []).map((task) => ({ value: task.id, label: `${task.task_number || "未编号"} · ${task.name || "未命名任务"}`, count: taskCounts.get(task.id) || 0 })).filter((task) => task.count > 0), role: account.role, owner_options: ownerScope.options, selected_owner_id: ownerScope.selectedOwnerId, can_select_owner: ownerScope.canSelectOwner, scope_label: reverify ? "可复验的已完成分析客户" : ownerScope.scopeLabel, all_scope_label: ownerScope.allScopeLabel });
  } catch (error) {
    const message = error instanceof Error ? error.message : "待筛选客户查询失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录会话已失效，请重新登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
