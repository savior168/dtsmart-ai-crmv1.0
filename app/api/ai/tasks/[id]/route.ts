import { NextRequest, NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { hasPermission, requirePermission, type CurrentAccount } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_CLOUD_DISPATCH_POLICY, AI_CLOUD_EXECUTION_MODE, type AiDispatchPolicy, type AiStrategy } from "@/lib/ai/task-types";
import { dispatchAiScreeningTask } from "@/lib/ai/task-dispatch";
import { getReservedAiCustomerIds } from "@/lib/ai/task-eligibility";

function taskNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AI-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function taskDispatchPolicy(): AiDispatchPolicy {
  return AI_CLOUD_DISPATCH_POLICY;
}

async function ownedTask(id: string, account: CurrentAccount) {
  const admin = createAdminClient();
  let query = admin.from("ai_screening_tasks").select("*").eq("id", id);
  if (!hasPermission(account, "ai.data_all")) query = query.eq("user_id", account.id);
  const result = await query.single();
  if (result.error || !result.data) throw result.error || new Error("任务不存在或无权访问");
  return result.data;
}

function accumulatedElapsed(task: { elapsed_ms?: number | null; started_at?: string | null }) {
  const previous = Number(task.elapsed_ms || 0);
  if (!task.started_at) return previous;
  const started = new Date(task.started_at).getTime();
  return previous + (Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0);
}

async function cancelWorkflowRun(runId?: string | null) {
  if (!runId) return;
  const run = getRun(runId);
  if (!(await run.exists)) return;
  try {
    await run.cancel();
  } catch (error) {
    // Pausing already cancels the durable run. A later explicit cancellation
    // must remain idempotent instead of trapping the task in PAUSED merely
    // because the same run is already terminal.
    const message = error instanceof Error ? error.message : String(error || "");
    if (/already finished|already cancelled|status ['\"]?cancelled/i.test(message)) return;
    throw error;
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.tasks.view");
    const { id } = await context.params;
    const task = await ownedTask(id, account);
    const admin = createAdminClient();
    let googlePlacesCallCount = 0;
    const googlePlacesSkuBreakdown: Record<string, { count: number; amount_usd: number }> = {};
    for (let offset = 0; ; offset += 1000) {
      const ledger = await admin.from("api_cost_ledger")
        .select("quantity,model_or_sku,amount_usd")
        .eq("task_id", id)
        .eq("provider", "GOOGLE_PLACES")
        .range(offset, offset + 999);
      if (ledger.error) throw ledger.error;
      const rows = ledger.data || [];
      for (const row of rows) {
        const quantity = Math.max(0, Number(row.quantity || 1));
        const sku = String(row.model_or_sku || "HISTORICAL_UNCLASSIFIED");
        googlePlacesCallCount += quantity;
        const current = googlePlacesSkuBreakdown[sku] || { count: 0, amount_usd: 0 };
        current.count += quantity;
        current.amount_usd = Number((current.amount_usd + Number(row.amount_usd || 0)).toFixed(6));
        googlePlacesSkuBreakdown[sku] = current;
      }
      if (rows.length < 1000) break;
    }
    const [budgetEvents, creator] = await Promise.all([
      admin.from("api_cost_budget_events").select("provider,blocked_period").eq("task_id", id),
      task.user_id ? admin.from("users").select("id,name,email").eq("id", task.user_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (budgetEvents.error && budgetEvents.error.code !== "42P01") throw budgetEvents.error;
    if (creator.error) throw creator.error;
    const paidApiBudgetBlocks = (budgetEvents.data || []).reduce((all, row) => {
      const key = `${row.provider}:${row.blocked_period}`;
      all[key] = (all[key] || 0) + 1;
      return all;
    }, {} as Record<string, number>);
    return NextResponse.json({ task: { ...task, creator: creator.data, google_places_call_count: googlePlacesCallCount, google_places_sku_breakdown: googlePlacesSkuBreakdown, paid_api_budget_blocks: paidApiBudgetBlocks } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 404 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, account } = await requirePermission("ai.tasks.control");
    const { id } = await context.params;
    const body = await request.json() as {
      action?: "pause" | "resume" | "cancel" | "retry" | "reanalyze" | "reanalyze_invalid" | "edit";
      name?: string; scheduled_at?: string | null; notification_mode?: string; source_task_ids?: string[]; customer_ids?: string[];
    };
    const task = await ownedTask(id, account);
    if (task.user_id !== user.id && account.role !== "ADMIN") return NextResponse.json({ error: "其他用户的AI任务仅供查看，不能控制或修改" }, { status: 403 });
    const admin = createAdminClient();
    if (body.action === "pause") {
      if (!["RUNNING", "PAUSING"].includes(task.status)) return NextResponse.json({ error: "只有执行中的任务可以停止" }, { status: 409 });
      const now = new Date().toISOString();
      const pausing = await admin.from("ai_screening_tasks").update({ status: "PAUSING", updated_at: now }).eq("id", id);
      if (pausing.error) throw pausing.error;
      await cancelWorkflowRun(task.workflow_run_id);
      const invalidatePartial = await admin.from("ai_screening_results").update({ is_latest_valid: false }).eq("task_id", id).neq("writeback_status", "COMPLETED");
      if (invalidatePartial.error) throw invalidatePartial.error;
      const resetItems = await admin.from("ai_screening_task_items").update({
        status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING",
        automation_status: null, result_id: null, progress: 0, current_step: "WAITING",
        pipeline_stage: "NORMALIZED", started_at: null, completed_at: null, updated_at: now,
      }).eq("task_id", id).eq("status", "RUNNING");
      if (resetItems.error) throw resetItems.error;
      const paused = await admin.from("ai_screening_tasks").update({
        status: "PAUSED", started_at: null, pause_started_at: now,
        elapsed_ms: accumulatedElapsed(task), cancel_requested: false, updated_at: now,
      }).eq("id", id);
      if (paused.error) throw paused.error;
      await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: id });
    } else if (body.action === "cancel") {
      if (!["QUEUED", "PAUSED"].includes(task.status)) return NextResponse.json({ error: "只有排队中或已停止的任务可以取消" }, { status: 409 });
      await cancelWorkflowRun(task.workflow_run_id);
      const now = new Date().toISOString();
      const cancelled = await admin.from("ai_screening_tasks").update({
        status: "CANCELLED", cancel_requested: true, cancelled_at: now, finished_at: now,
        elapsed_ms: accumulatedElapsed(task), updated_at: now,
      }).eq("id", id);
      if (cancelled.error) throw cancelled.error;
    } else if (body.action === "resume") {
      if (task.status !== "PAUSED") return NextResponse.json({ error: "只有已停止的任务可以继续执行" }, { status: 409 });
      const now = new Date().toISOString();
      // Requeue legacy evidence-deficient completions only when the user
      // explicitly resumes the task. Scored results remain untouched and the
      // previous rows stay available as immutable audit history.
      const legacyHolds = await admin.from("ai_screening_task_items").select("id").eq("task_id", id).eq("status", "COMPLETED").eq("automation_status", "AUTO_HOLD");
      if (legacyHolds.error) throw legacyHolds.error;
      const legacyIds = (legacyHolds.data || []).map((item) => item.id);
      if (legacyIds.length) {
        const invalidate = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", legacyIds);
        if (invalidate.error) throw invalidate.error;
        const requeue = await admin.from("ai_screening_task_items").update({
          status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING",
          automation_status: null, result_id: null, progress: 0, current_step: "WAITING",
          pipeline_stage: "NORMALIZED", retry_at: null, completed_at: null, updated_at: now,
        }).in("id", legacyIds);
        if (requeue.error) throw requeue.error;
      }
      const queued = await admin.from("ai_screening_tasks").update({
        // beginTask records the paused interval and clears pause_started_at at
        // the moment cloud execution really resumes. Clearing it here would
        // make manual-stop time look like task execution time.
        status: "QUEUED", cancel_requested: false, completed_at: null, finished_at: null,
        error_message: null, execution_mode: AI_CLOUD_EXECUTION_MODE, dispatch_policy: taskDispatchPolicy(),
        active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: now,
      }).eq("id", id);
      if (queued.error) throw queued.error;
      await dispatchAiScreeningTask({ taskId: id, strategy: task.strategy as AiStrategy, scheduledAt: null, executionMode: AI_CLOUD_EXECUTION_MODE, dispatchPolicy: taskDispatchPolicy() });
    } else if (body.action === "retry") {
      if (!["FAILED", "COMPLETED"].includes(task.status)) return NextResponse.json({ error: "只有失败任务或含失败客户的已完成任务可以重试" }, { status: 409 });
      const failed = await admin.from("ai_screening_task_items").select("id", { count: "exact", head: true }).eq("task_id", id).eq("status", "FAILED").eq("retryable", true).lt("attempt_count", 3);
      if (failed.error) throw failed.error;
      const pending = task.status === "FAILED"
        ? await admin.from("ai_screening_task_items").select("id", { count: "exact", head: true }).eq("task_id", id).in("status", ["PENDING", "RUNNING"])
        : { count: 0, error: null };
      if (pending.error) throw pending.error;
      if (!failed.count && !pending.count) return NextResponse.json({ error: "当前任务没有可重试或未完成的客户" }, { status: 409 });
      if (task.status === "FAILED") {
        const resetRunning = await admin.from("ai_screening_task_items").update({ status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null, result_id: null, progress: 0, current_step: "WAITING", pipeline_stage: "NORMALIZED", started_at: null, completed_at: null, updated_at: new Date().toISOString() }).eq("task_id", id).eq("status", "RUNNING");
        if (resetRunning.error) throw resetRunning.error;
      }
      const failedIds = await admin.from("ai_screening_task_items").select("id").eq("task_id", id).eq("status", "FAILED").eq("retryable", true).lt("attempt_count", 3);
      if (failedIds.error) throw failedIds.error;
      const ids = (failedIds.data || []).map((item) => item.id);
      if (ids.length) {
        const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", ids);
        if (invalidated.error) throw invalidated.error;
      }
      const reset = await admin.from("ai_screening_task_items").update({ status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null, result_id: null, progress: 0, current_step: "WAITING", pipeline_stage: "NORMALIZED", error_message: null, error_code: null, error_context: {}, writeback_warning_count: 0, retry_at: null, completed_at: null, updated_at: new Date().toISOString() }).eq("task_id", id).eq("status", "FAILED").eq("retryable", true).lt("attempt_count", 3);
      if (reset.error) throw reset.error;
      await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: id });
      const queued = await admin.from("ai_screening_tasks").update({
        status: "QUEUED", completed_at: null, finished_at: null, error_message: null, cancel_requested: false,
        execution_mode: AI_CLOUD_EXECUTION_MODE, dispatch_policy: taskDispatchPolicy(),
        active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (queued.error) throw queued.error;
      await dispatchAiScreeningTask({ taskId: id, strategy: task.strategy as AiStrategy, scheduledAt: null, executionMode: AI_CLOUD_EXECUTION_MODE, dispatchPolicy: taskDispatchPolicy() });
    } else if (body.action === "reanalyze_invalid") {
      const sourceTaskIds = [...new Set([id, ...(body.source_task_ids || [])].filter(Boolean))].slice(0, 10);
      const sourceTasks = [];
      for (const sourceTaskId of sourceTaskIds) {
        const sourceTask = await ownedTask(sourceTaskId, account);
        if (sourceTask.user_id !== user.id && account.role !== "ADMIN") return NextResponse.json({ error: "其他用户的AI任务仅供查看，不能创建复验任务" }, { status: 403 });
        if (!["COMPLETED", "FAILED", "CANCELLED"].includes(sourceTask.status)) return NextResponse.json({ error: `任务“${sourceTask.name}”尚未结束，不能创建无效结果复验任务` }, { status: 409 });
        sourceTasks.push(sourceTask);
      }
      const sourceItems = await admin.from("ai_screening_task_items").select("customer_id").in("task_id", sourceTaskIds).eq("automation_status", "AUTO_REJECT");
      if (sourceItems.error) throw sourceItems.error;
      const historicalInvalidIds = new Set((sourceItems.data || []).map((item) => String(item.customer_id || "")).filter(Boolean));
      const requestedCustomerIds = [...new Set((body.customer_ids || []).map(String).filter(Boolean))];
      const candidateIds = requestedCustomerIds.length
        ? requestedCustomerIds.filter((customerId) => historicalInvalidIds.has(customerId))
        : [...historicalInvalidIds];
      if (requestedCustomerIds.length && candidateIds.length !== requestedCustomerIds.length) {
        return NextResponse.json({ error: "所选客户中包含不属于历史无效结果的数据，已阻止混入复验任务" }, { status: 409 });
      }
      if (!candidateIds.length) return NextResponse.json({ error: "所选历史任务没有无效目标客户" }, { status: 409 });
      const eligibleIds: string[] = [];
      for (let offset = 0; offset < candidateIds.length; offset += 200) {
        const customers = await admin.from("customers").select("id").in("id", candidateIds.slice(offset, offset + 200)).is("deleted_at", null);
        if (customers.error) throw customers.error;
        eligibleIds.push(...(customers.data || []).map((item) => String(item.id)));
      }
      const reserved = await getReservedAiCustomerIds();
      const customerIds = eligibleIds.filter((customerId) => !reserved.has(customerId));
      if (!customerIds.length) return NextResponse.json({ error: "历史无效客户均已删除或正在其他任务中分析" }, { status: 409 });
      const strategy = "SMART" as const;
      const created = await admin.from("ai_screening_tasks").insert({
        user_id: task.user_id,
        task_number: taskNumber(),
        name: (body.name?.trim() || `历史无效客户复验-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`).slice(0, 80),
        strategy,
        strategy_version: "1.0",
        status: "QUEUED",
        total_count: customerIds.length,
        pending_count: customerIds.length,
        filters: { force_fresh_analysis: true, reanalysis_scope: "INVALID", source_task_ids: sourceTaskIds, source_task_numbers: sourceTasks.map((item) => item.task_number) },
        selection_mode: "FILTERED",
        notification_mode: body.notification_mode || task.notification_mode || "IN_APP",
        cost_mode: task.cost_mode || "ADAPTIVE",
        task_cost_limit_usd: task.cost_mode === "FREE_ONLY" ? 0 : task.task_cost_limit_usd ?? null,
        execution_mode: AI_CLOUD_EXECUTION_MODE,
        dispatch_policy: taskDispatchPolicy(),
      }).select("*").single();
      if (created.error || !created.data) throw created.error || new Error("无效客户复验任务创建失败");
      const rows = customerIds.map((customerId) => ({ task_id: created.data.id, customer_id: customerId, status: "PENDING", strategy, strategy_version: "1.0" }));
      try {
        for (let offset = 0; offset < rows.length; offset += 500) {
          const inserted = await admin.from("ai_screening_task_items").insert(rows.slice(offset, offset + 500));
          if (inserted.error) throw inserted.error;
        }
        const dispatch = await dispatchAiScreeningTask({ taskId: created.data.id, strategy, scheduledAt: null, executionMode: AI_CLOUD_EXECUTION_MODE, dispatchPolicy: taskDispatchPolicy() });
        await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_INVALID_RESULTS_REANALYZE", target_type: "ai_screening_task", target_id: created.data.id, content: { source_task_ids: sourceTaskIds, source_task_numbers: sourceTasks.map((item) => item.task_number), task_number: created.data.task_number, total_count: customerIds.length } });
        return NextResponse.json({ success: true, task: { ...created.data, workflow_run_id: dispatch.runId, active_executor: dispatch.executor } }, { status: 201 });
      } catch (error) {
        await admin.from("ai_screening_tasks").update({ status: "FAILED", error_message: error instanceof Error ? error.message.slice(0, 1000) : "无效客户复验任务启动失败", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", created.data.id);
        throw error;
      }
    } else if (body.action === "reanalyze") {
      if (!['COMPLETED', 'FAILED'].includes(task.status)) return NextResponse.json({ error: "只有已结束的任务可以创建全量复核任务" }, { status: 409 });
      const sourceItems = await admin.from("ai_screening_task_items").select("customer_id").eq("task_id", id);
      if (sourceItems.error) throw sourceItems.error;
      const customerIds = [...new Set((sourceItems.data || []).map((item) => String(item.customer_id || "")).filter(Boolean))];
      if (!customerIds.length) return NextResponse.json({ error: "原任务没有可重新分析的客户" }, { status: 409 });
      const reserved = await getReservedAiCustomerIds();
      const conflicts = customerIds.filter((customerId) => reserved.has(customerId));
      if (conflicts.length) return NextResponse.json({ error: `有 ${conflicts.length} 条客户正在其他任务中分析，请完成后再执行全量复核` }, { status: 409 });
      const strategy = "SMART" as const;
      const created = await admin.from("ai_screening_tasks").insert({
        user_id: task.user_id,
        task_number: taskNumber(),
        name: `${task.name}（全量复核）`.slice(0, 80),
        strategy,
        strategy_version: "1.0",
        status: "QUEUED",
        total_count: customerIds.length,
        pending_count: customerIds.length,
        filters: { reanalysis_scope: "SELECTIVE", reuse_only_valid_results: true, reanalysis_source_task_id: id, reanalysis_source_task_number: task.task_number },
        selection_mode: "FILTERED",
        notification_mode: task.notification_mode || "IN_APP",
        cost_mode: task.cost_mode || "ADAPTIVE",
        task_cost_limit_usd: task.cost_mode === "FREE_ONLY" ? 0 : task.task_cost_limit_usd ?? null,
        execution_mode: AI_CLOUD_EXECUTION_MODE,
        dispatch_policy: taskDispatchPolicy(),
      }).select("*").single();
      if (created.error || !created.data) throw created.error || new Error("全量复核任务创建失败");
      const rows = customerIds.map((customerId) => ({ task_id: created.data.id, customer_id: customerId, status: "PENDING", strategy, strategy_version: "1.0" }));
      try {
        for (let offset = 0; offset < rows.length; offset += 500) {
          const inserted = await admin.from("ai_screening_task_items").insert(rows.slice(offset, offset + 500));
          if (inserted.error) throw inserted.error;
        }
        const dispatch = await dispatchAiScreeningTask({ taskId: created.data.id, strategy, scheduledAt: null, executionMode: AI_CLOUD_EXECUTION_MODE, dispatchPolicy: taskDispatchPolicy() });
        await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_TASK_REANALYZE", target_type: "ai_screening_task", target_id: created.data.id, content: { source_task_id: id, source_task_number: task.task_number, task_number: created.data.task_number, total_count: customerIds.length } });
        return NextResponse.json({ success: true, task: { ...created.data, workflow_run_id: dispatch.runId, active_executor: dispatch.executor } }, { status: 201 });
      } catch (error) {
        await admin.from("ai_screening_tasks").update({ status: "FAILED", error_message: error instanceof Error ? error.message.slice(0, 1000) : "全量复核任务启动失败", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", created.data.id);
        throw error;
      }
    } else if (body.action === "edit") {
      if (task.status !== "QUEUED") return NextResponse.json({ error: "只有尚未执行的排队任务可以编辑" }, { status: 409 });
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "请输入任务名称" }, { status: 400 });
      const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null;
      if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: "预约执行时间无效" }, { status: 400 });
      const updated = await admin.from("ai_screening_tasks").update({
        name,
        scheduled_at: scheduledAt?.toISOString() || null,
        notification_mode: body.notification_mode || task.notification_mode,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("status", "QUEUED");
      if (updated.error) throw updated.error;
    } else {
      return NextResponse.json({ error: "不支持的任务操作" }, { status: 400 });
    }
    await admin.from("audit_logs").insert({ user_id: user.id, action: `AI_TASK_${String(body.action || "UNKNOWN").toUpperCase()}`, target_type: "ai_screening_task", target_id: id, content: { task_number: task.task_number, previous_status: task.status } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, account } = await requirePermission("ai.tasks.delete");
    const { id } = await context.params;
    const task = await ownedTask(id, account);
    if (task.user_id !== user.id && account.role !== "ADMIN") return NextResponse.json({ error: "其他用户的AI任务仅供查看，不能删除" }, { status: 403 });
    if (!['COMPLETED', 'CANCELLED', 'FAILED'].includes(task.status)) return NextResponse.json({ error: "只有已完成、已取消或执行失败的任务可以归档" }, { status: 409 });
    const admin = createAdminClient();
    let removeQuery = admin.from("ai_screening_tasks").update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).in("status", ['COMPLETED', 'CANCELLED', 'FAILED']);
    if (account.role !== "ADMIN") removeQuery = removeQuery.eq("user_id", user.id);
    const removed = await removeQuery;
    if (removed.error) throw removed.error;
    await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_TASK_ARCHIVE", target_type: "ai_screening_task", target_id: id, content: { task_number: task.task_number, status: task.status, result: "任务已归档；客户结果、证据及费用账本保留" } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务删除失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

