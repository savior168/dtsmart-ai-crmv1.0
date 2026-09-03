import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerIndexIdentityKeys, customerLookupIdentityKeys } from "@/lib/import-dedupe";

type Row = { company_name?: string; email?: string; phone?: string; import_meta?: Record<string, unknown>; [key: string]: unknown };
type ImportResult = {
  file_name: string;
  row_number: number;
  status: "success" | "duplicate" | "error" | "conflict" | "failed";
  reason?: string;
  owner_name?: string;
};
const text = (value: unknown) => String(value || "").trim();
const bounded = (value: unknown, min: number, max: number) => {
  const match = text(value).replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
};
function identity(row: Row) { return { lookupKeys: customerLookupIdentityKeys(row), indexKeys: customerIndexIdentityKeys(row) }; }
function importErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/customers_assigned_via_check/i.test(message)) return "客户归属来源不合法，请检查导入目标后重试";
  if (/customers_acquisition_scope_check|customers_pool_status_check/i.test(message)) return "客户公海状态不合法，请检查导入目标后重试";
  return message || "导入失败，请稍后重试";
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user, account } = await requirePermission("imports.create");
    const admin = createAdminClient();
    const payload = await request.json() as { filename?: string; rows?: Row[]; destination?: string };
    const publicPool = payload.destination === "PUBLIC_POOL";
    if (publicPool && account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可以向客户公海导入数据" }, { status: 403 });
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) return NextResponse.json({ error: "没有可导入的数据" }, { status: 400 });

    // 先创建任务记录，页面离开后仍可通过任务列表恢复进度。
    const taskPayload = { filename: payload.filename || "批量导入", total_count: rows.length, success_count: 0, duplicate_count: 0, failed_count: 0, created_by: user.id };
    const { data: startedTask } = await supabase.from("import_tasks").insert(taskPayload).select("id").single();
    const taskId = startedTask?.id as string | undefined;

    // 一次预取现有客户，避免逐条请求导致导入卡顿或超时。
    const existing: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await admin.from("customers")
        .select("id,company_name,contact_name,country,phone,email,website,google_url,address,industry,category,source,tags,owner_id,created_at,deleted_at")
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (page.error) throw page.error;
      existing.push(...(page.data || []));
      if ((page.data || []).length < 1000) break;
    }
    const seen = new Map<string, Record<string, unknown>>();
    existing.forEach((row) => identity(row as Row).indexKeys.forEach((key) => { if (!seen.has(key)) seen.set(key, row); }));
    const ownerIds = Array.from(new Set(existing.map((row) => text(row.owner_id)).filter(Boolean)));
    const ownerNames = new Map<string, string>();
    if (ownerIds.length) {
      const { data: owners } = await admin.from("users").select("id,name,email").in("id", ownerIds);
      (owners || []).forEach((owner) => ownerNames.set(owner.id, owner.name || owner.email || owner.id));
    }
    const accepted: Array<{ row: Row; fileName: string; rowNumber: number }> = [];
    let duplicate = 0;
    let invalid = 0;
    let failed = 0;
    const errors: string[] = [];
    const results: ImportResult[] = [];
    const conflicts: Record<string, unknown>[] = [];
    const transferCandidates: Array<{ customer: Record<string, unknown>; submitted: Row; fileName: string; rowNumber: number }> = [];
    rows.forEach((raw, index) => {
      const item = { ...raw };
      const importMeta = item.import_meta && typeof item.import_meta === "object" ? item.import_meta : {};
      const fileName = text(importMeta.file_name) || payload.filename || "导入文件";
      const rowNumber = Number(importMeta.row_number) || index + 2;
      if ("rating" in item) item.rating = bounded(item.rating, 0, 5);
      if ("ai_score" in item) item.ai_score = bounded(item.ai_score, 0, 100);
      const current = identity(item);
      try {
        if (!text(item.company_name)) throw new Error("客户名称为空");
        if (![item.phone, item.email, item.website, item.google_url].some((value) => text(value))) throw new Error("缺少电话、邮箱、官网或 Google 地图联系方式");
        const duplicateOf = current.lookupKeys.map((key) => seen.get(key)).find(Boolean);
        if (duplicateOf) {
          if (!duplicateOf.id) {
            duplicate += 1;
            results.push({ file_name: fileName, row_number: rowNumber, status: "duplicate", reason: "本次导入文件中存在相同客户" });
            return;
          }
          // A duplicate never creates a second customer. When it belongs to
          // another salesperson, retain the importer's original basic fields
          // in the conflict queue for read-only review.
          if (publicPool) {
            duplicate += 1;
            results.push({ file_name: fileName, row_number: rowNumber, status: "duplicate", reason: duplicateOf.owner_id ? "客户已存在且已有归属人，未重复加入公海" : "客户已存在于客户公海" });
          } else if (duplicateOf.owner_id !== user.id) {
            transferCandidates.push({ customer: duplicateOf, submitted: item, fileName, rowNumber });
          } else {
            failed += 1;
            const reason = "客户已存在于我的客户列表，保留最先导入的数据";
            errors.push(`${fileName} 第 ${rowNumber} 行：${reason}`);
            results.push({ file_name: fileName, row_number: rowNumber, status: "failed", reason });
          }
          return;
        }
        current.indexKeys.forEach((key) => seen.set(key, item));
        delete item.import_meta;
        // 兼容旧版 customers 表：AI 筛选状态列由筛选接口按 schema 兼容处理，导入不应因缺少该可选列而整批失败。
        delete item.ai_screening_done;
        delete item.website_email;
        delete item.website_phone;
        accepted.push({ row: publicPool
          ? { ...item, source_channel: "BATCH_IMPORT", source_batch: fileName, source_batch_id: taskId || null, status: "UNCLAIMED", followup_status: "WAITING_CONTACT", created_by: user.id, owner_id: null, owner_user_id: null, acquisition_scope: "PUBLIC_POOL", pool_status: "AVAILABLE", assigned_via: "ADMIN_ASSIGN" }
          : { ...item, source_channel: "BATCH_IMPORT", source_batch: fileName, source_batch_id: taskId || null, status: "CLAIMED", followup_status: "WAITING_CONTACT", created_by: user.id, owner_id: user.id, owner_user_id: user.id, acquisition_scope: "PRIVATE", pool_status: "CLAIMED", assigned_via: "PRIVATE_IMPORT" }, fileName, rowNumber });
      } catch (reason) {
        invalid += 1;
        const message = reason instanceof Error ? reason.message : "数据格式错误";
        errors.push(`${fileName} 第 ${rowNumber} 行：${message}`);
        results.push({ file_name: fileName, row_number: rowNumber, status: "error", reason: message });
      }
    });

    let transferredCount = 0;
    const firstCandidateByCustomer = new Map<string, typeof transferCandidates[number]>();
    transferCandidates.forEach((candidate) => {
      const id = String(candidate.customer.id || "");
      if (id && !firstCandidateByCustomer.has(id)) firstCandidateByCustomer.set(id, candidate);
    });
    const transferOutcome = new Map<string, { transferred: boolean; reason?: string }>();
    const uniqueCandidates = [...firstCandidateByCustomer.entries()];
    for (let offset = 0; offset < uniqueCandidates.length; offset += 20) {
      await Promise.all(uniqueCandidates.slice(offset, offset + 20).map(async ([customerId]) => {
        const outcome = await supabase.rpc("take_over_expired_customer", { p_customer_id: customerId, p_source: "BATCH_IMPORT" });
        if (outcome.error) throw new Error(`客户归属校验失败：${outcome.error.message}`);
        const value = outcome.data && typeof outcome.data === "object" ? outcome.data as { transferred?: boolean; reason?: string } : {};
        transferOutcome.set(customerId, { transferred: Boolean(value.transferred), reason: value.reason });
      }));
    }
    const successfulTransferIds = new Set<string>();
    for (const candidate of transferCandidates) {
      const customerId = String(candidate.customer.id || "");
      const outcome = transferOutcome.get(customerId);
      if (outcome?.transferred && !successfulTransferIds.has(customerId)) {
        successfulTransferIds.add(customerId);
        transferredCount += 1;
        results.push({ file_name: candidate.fileName, row_number: candidate.rowNumber, status: "success", reason: "原保护期及宽限期已结束，客户已自动转归当前用户" });
        continue;
      }
      if (outcome?.transferred) {
        duplicate += 1;
        results.push({ file_name: candidate.fileName, row_number: candidate.rowNumber, status: "duplicate", reason: "本次导入文件中存在相同客户" });
        continue;
      }
      conflicts.push({
        customer_id: customerId,
        reported_by: user.id,
        conflict_type: "CROSS_OWNER_DUPLICATE",
        status: "OPEN",
        details: { submitted: { company_name: candidate.submitted.company_name || null, contact_name: candidate.submitted.contact_name || null, country: candidate.submitted.country || null, phone: candidate.submitted.phone || null, email: candidate.submitted.email || null, website: candidate.submitted.website || null, google_url: candidate.submitted.google_url || null, address: candidate.submitted.address || null, industry: candidate.submitted.industry || null, category: candidate.submitted.category || null, source: candidate.submitted.source || null, tags: candidate.submitted.tags || [] }, matched_customer_id: customerId },
      });
      results.push({ file_name: candidate.fileName, row_number: candidate.rowNumber, status: "conflict", reason: outcome?.reason === "PERMANENT_PROTECTION" ? "已成交客户永久保护，归属保持不变" : "客户仍在保护期或7天宽限期，归属保持不变", owner_name: ownerNames.get(String(candidate.customer.owner_id)) || String(candidate.customer.owner_id || "") });
    }

    if (conflicts.length) {
      const conflictIds = Array.from(new Set(conflicts.map((item) => String(item.customer_id))));
      // 已完成登录和imports.create权限校验，冲突队列由服务端写入。
      // 旧生产库曾因冲突表启用RLS却缺少策略，用户会话写入全部失败。
      const prior = await admin.from("customer_conflicts").select("customer_id").eq("reported_by", user.id).eq("status", "OPEN").in("customer_id", conflictIds);
      const priorIds = new Set((prior.data || []).map((item) => String(item.customer_id)));
      const newConflicts = conflicts.filter((item) => !priorIds.has(String(item.customer_id)));
      const { error: conflictError } = newConflicts.length
        ? await admin.from("customer_conflicts").insert(newConflicts)
        : { error: null };
      // Production databases upgraded from the original schema may not yet
      // have the optional conflict table. Never lose a valid import because
      // of that: retain the same immutable conflict snapshot in audit_logs.
      if (conflictError) {
        const { error: auditConflictError } = await supabase.from("audit_logs").insert(newConflicts.map((item) => ({
          user_id: user.id, action: "CUSTOMER_CONFLICT_DETECTED", target_type: "customer",
          target_id: item.customer_id as string, content: item,
        })));
        if (auditConflictError) throw new Error(`冲突客户记录创建失败：${auditConflictError.message}`);
      }
    }

    let success = transferredCount;
    for (let offset = 0; offset < accepted.length; offset += 100) {
      const chunk = accepted.slice(offset, offset + 100);
      const chunkRows = chunk.map((item) => item.row);
      let { data, error } = await admin.from("customers").insert(chunkRows).select("id");
      // Some production projects were initialized before the followup_status
      // migration. Retry the same rows without that additive column so a
      // schema-cache lag cannot reject the entire import batch. The customer
      // list/API treats a missing value as WAITING_CONTACT until the migration
      // is applied, preserving the required default workflow state.
      if (error && /(followup_status|source_batch_id).*(column|schema cache)|column.*(followup_status|source_batch_id)/i.test(error.message)) {
        const legacyChunk = chunkRows.map((row) => { const legacyRow = { ...row }; delete legacyRow.followup_status; delete legacyRow.source_batch_id; return legacyRow; });
        ({ data, error } = await admin.from("customers").insert(legacyChunk).select("id"));
      }
      if (error?.code === "23505") {
        // 兼容已启用数据库唯一约束的环境：批量冲突时逐条重试，
        // 准确区分重复行与其他失败行，避免整批误报失败。
        for (const item of chunk) {
          let single = await admin.from("customers").insert(item.row).select("id").single();
          if (single.error && /(followup_status|source_batch_id).*(column|schema cache)|column.*(followup_status|source_batch_id)/i.test(single.error.message)) {
            const legacyRow = { ...item.row };
            delete legacyRow.followup_status;
            delete legacyRow.source_batch_id;
            single = await admin.from("customers").insert(legacyRow).select("id").single();
          }
          if (single.error?.code === "23505") {
            failed += 1;
            const reason = "客户已存在于系统，保留最先导入的数据";
            errors.push(`${item.fileName} 第 ${item.rowNumber} 行：${reason}`);
            results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "failed", reason });
          } else if (single.error) {
            failed += 1;
            const reason = importErrorMessage(single.error);
            errors.push(`${item.fileName} 第 ${item.rowNumber} 行：${reason}`);
            results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "failed", reason });
          } else {
            success += 1;
            results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "success" });
          }
        }
        continue;
      }
      if (error) {
        failed += chunk.length;
        chunk.forEach((item) => {
          const reason = importErrorMessage(error);
          errors.push(`${item.fileName} 第 ${item.rowNumber} 行：${reason}`);
          results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "failed", reason });
        });
        continue;
      }
      success += data?.length || chunk.length;
      chunk.forEach((item) => results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "success" }));
      if (taskId) await supabase.from("import_tasks").update({ success_count: success, duplicate_count: duplicate, failed_count: failed + invalid }).eq("id", taskId);
    }
    const stats = { total_count: rows.length, success_count: success, duplicate_count: duplicate, conflict_count: conflicts.length, error_count: invalid, failed_count: failed };
    if (taskId) await supabase.from("import_tasks").update({ total_count: stats.total_count, success_count: success, duplicate_count: duplicate, failed_count: failed + invalid }).eq("id", taskId);
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "IMPORT_COMPLETE",
      target_type: "import_task",
      target_id: taskId,
      content: { filename: payload.filename || "批量导入", destination: publicPool ? "PUBLIC_POOL" : "PRIVATE", ...stats },
      result: failed + invalid > 0 ? "部分成功" : "成功",
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ ...stats, errors, results, task_id: taskId });
  } catch (error) { return NextResponse.json({ error: importErrorMessage(error) }, { status: 400 }); }
}

export async function GET(request: Request) {
  try {
    const { supabase, account } = await requirePermission("imports.view");
    const scopeUserId = requestedOwnerId(request, account, "imports.data_all");
    let query = supabase.from("import_tasks").select("id,filename,total_count,success_count,duplicate_count,failed_count,created_at,created_by");
    if (scopeUserId) query = query.eq("created_by", scopeUserId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ tasks: data || [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导入任务读取失败" }, { status: 400 });
  }
}
