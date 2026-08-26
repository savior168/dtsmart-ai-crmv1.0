import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
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

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const admin = createAdminClient();
    const payload = await request.json() as { filename?: string; rows?: Row[] };
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
    const claimIds: string[] = [];
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
          if (duplicateOf.owner_id && duplicateOf.owner_id !== user.id) {
            conflicts.push({
              customer_id: duplicateOf.id,
              reported_by: user.id,
              conflict_type: "CROSS_OWNER_DUPLICATE",
              status: "OPEN",
              details: { submitted: { company_name: item.company_name || null, contact_name: item.contact_name || null, country: item.country || null, phone: item.phone || null, email: item.email || null, website: item.website || null, google_url: item.google_url || null, address: item.address || null, industry: item.industry || null, category: item.category || null, source: item.source || null, tags: item.tags || [] }, matched_customer_id: duplicateOf.id },
            });
            results.push({ file_name: fileName, row_number: rowNumber, status: "conflict", reason: "客户已归属其他销售员", owner_name: ownerNames.get(String(duplicateOf.owner_id)) || String(duplicateOf.owner_id) });
          } else if (!duplicateOf.owner_id) {
            claimIds.push(String(duplicateOf.id));
            results.push({ file_name: fileName, row_number: rowNumber, status: "success", reason: "客户已存在且无归属人，已自动认领" });
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
        accepted.push({ row: { ...item, source_channel: "新增&导入", source_batch: fileName, status: "UNCLAIMED", followup_status: "WAITING_CONTACT", created_by: user.id, owner_id: user.id }, fileName, rowNumber });
      } catch (reason) {
        invalid += 1;
        const message = reason instanceof Error ? reason.message : "数据格式错误";
        errors.push(`${fileName} 第 ${rowNumber} 行：${message}`);
        results.push({ file_name: fileName, row_number: rowNumber, status: "error", reason: message });
      }
    });

    if (claimIds.length) {
      const { error: claimError } = await admin
        .from("customers")
        .update({ owner_id: user.id, status: "CLAIMED" })
        .in("id", Array.from(new Set(claimIds)))
        .is("owner_id", null);
      if (claimError) throw new Error(`自动认领客户失败：${claimError.message}`);
    }

    if (conflicts.length) {
      const conflictIds = Array.from(new Set(conflicts.map((item) => String(item.customer_id))));
      const prior = await supabase.from("customer_conflicts").select("customer_id").eq("reported_by", user.id).eq("status", "OPEN").in("customer_id", conflictIds);
      const priorIds = new Set((prior.data || []).map((item) => String(item.customer_id)));
      const newConflicts = conflicts.filter((item) => !priorIds.has(String(item.customer_id)));
      const { error: conflictError } = newConflicts.length
        ? await supabase.from("customer_conflicts").insert(newConflicts)
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

    let success = 0;
    const auditRows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < accepted.length; offset += 100) {
      const chunk = accepted.slice(offset, offset + 100);
      const chunkRows = chunk.map((item) => item.row);
      let { data, error } = await supabase.from("customers").insert(chunkRows).select("id");
      // Some production projects were initialized before the followup_status
      // migration. Retry the same rows without that additive column so a
      // schema-cache lag cannot reject the entire import batch. The customer
      // list/API treats a missing value as WAITING_CONTACT until the migration
      // is applied, preserving the required default workflow state.
      if (error && /followup_status.*(column|schema cache)|column.*followup_status/i.test(error.message)) {
        const legacyChunk = chunkRows.map((row) => { const legacyRow = { ...row }; delete legacyRow.followup_status; return legacyRow; });
        ({ data, error } = await supabase.from("customers").insert(legacyChunk).select("id"));
      }
      if (error?.code === "23505") {
        // 兼容已启用数据库唯一约束的环境：批量冲突时逐条重试，
        // 准确区分重复行与其他失败行，避免整批误报失败。
        for (const item of chunk) {
          let single = await supabase.from("customers").insert(item.row).select("id").single();
          if (single.error && /followup_status.*(column|schema cache)|column.*followup_status/i.test(single.error.message)) {
            const legacyRow = { ...item.row };
            delete legacyRow.followup_status;
            single = await supabase.from("customers").insert(legacyRow).select("id").single();
          }
          if (single.error?.code === "23505") {
            failed += 1;
            const reason = "客户已存在于系统，保留最先导入的数据";
            errors.push(`${item.fileName} 第 ${item.rowNumber} 行：${reason}`);
            results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "failed", reason });
          } else if (single.error) {
            failed += 1;
            errors.push(`${item.fileName} 第 ${item.rowNumber} 行：${single.error.message}`);
            results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "failed", reason: single.error.message });
          } else {
            success += 1;
            results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "success" });
            auditRows.push({ user_id: user.id, action: "CUSTOMER_IMPORT", target_type: "customer", target_id: single.data.id, content: { filename: item.fileName, row_number: item.rowNumber }, created_at: new Date().toISOString() });
          }
        }
        continue;
      }
      if (error) {
        failed += chunk.length;
        chunk.forEach((item) => {
          errors.push(`${item.fileName} 第 ${item.rowNumber} 行：${error.message}`);
          results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "failed", reason: error.message });
        });
        continue;
      }
      success += data?.length || chunk.length;
      chunk.forEach((item) => results.push({ file_name: item.fileName, row_number: item.rowNumber, status: "success" }));
      (data || []).forEach((item, index) => auditRows.push({ user_id: user.id, action: "CUSTOMER_IMPORT", target_type: "customer", target_id: item.id, content: { filename: chunk[index]?.fileName || payload.filename || "批量导入", row_number: chunk[index]?.rowNumber || null }, created_at: new Date().toISOString() }));
      if (taskId) await supabase.from("import_tasks").update({ success_count: success, duplicate_count: duplicate, failed_count: failed + invalid }).eq("id", taskId);
    }
    if (auditRows.length) await supabase.from("audit_logs").insert(auditRows);
    const stats = { total_count: rows.length, success_count: success, duplicate_count: duplicate, conflict_count: conflicts.length, error_count: invalid, failed_count: failed };
    if (taskId) await supabase.from("import_tasks").update({ total_count: stats.total_count, success_count: success, duplicate_count: duplicate, failed_count: failed + invalid }).eq("id", taskId);
    if (taskId) await supabase.from("audit_logs").insert({ user_id: user.id, action: "IMPORT_COMPLETE", target_type: "import_task", target_id: taskId, content: stats, created_at: new Date().toISOString() });
    return NextResponse.json({ ...stats, errors, results, task_id: taskId });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败，请稍后重试" }, { status: 400 }); }
}

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("import_tasks").select("id,filename,total_count,success_count,duplicate_count,failed_count,created_at").eq("created_by", user.id).order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    return NextResponse.json({ tasks: data || [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导入任务读取失败" }, { status: 400 });
  }
}
