import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Row = { company_name?: string; email?: string; phone?: string; import_meta?: Record<string, unknown>; [key: string]: unknown };
const text = (value: unknown) => String(value || "").trim();
const nameKey = (value: unknown) => text(value).replace(/\s+/g, " ").toLowerCase();
const phoneKey = (value: unknown) => text(value).replace(/[\s()\-]/g, "");
const emailKey = (value: unknown) => text(value).toLowerCase();
const bounded = (value: unknown, min: number, max: number) => {
  const match = text(value).replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
};
function identity(row: Row) { const name = nameKey(row.company_name); const phone = phoneKey(row.phone); const email = emailKey(row.email); return { name, keys: [phone ? `p:${name}|${phone}` : "", email ? `e:${name}|${email}` : ""].filter(Boolean) }; }

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const admin = createAdminClient();
    const payload = await request.json() as { filename?: string; rows?: Row[] };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) return NextResponse.json({ error: "没有可导入的数据" }, { status: 400 });

    // 一次预取现有客户，避免逐条请求导致导入卡顿或超时。
    const { data: existing, error: existingError } = await admin.from("customers").select("id,company_name,contact_name,country,phone,email,website,google_url,address,industry,category,source,tags,owner_id").is("deleted_at", null).limit(10000);
    if (existingError) throw existingError;
    const seen = new Map<string, Record<string, unknown>>();
    (existing || []).forEach((row) => identity(row as Row).keys.forEach((key) => seen.set(key, row as Record<string, unknown>)));
    const accepted: Row[] = []; let duplicate = 0; let failed = 0; const errors: string[] = [];
    const conflicts: Record<string, unknown>[] = [];
    rows.forEach((raw, index) => {
      const item = { ...raw };
      if ("rating" in item) item.rating = bounded(item.rating, 0, 5);
      if ("ai_score" in item) item.ai_score = bounded(item.ai_score, 0, 100);
      const current = identity(item);
      try {
        if (!current.name) throw new Error("客户名称为空");
        if (![item.phone, item.email, item.website, item.google_url].some((value) => text(value))) throw new Error("缺少电话、邮箱、官网或 Google 地图联系方式");
        const duplicateOf = current.keys.map((key) => seen.get(key)).find(Boolean);
        if (duplicateOf) {
          duplicate += 1;
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
          }
          return;
        }
        current.keys.forEach((key) => seen.set(key, item));
        delete item.import_meta;
        // 兼容旧版 customers 表：AI 筛选状态列由筛选接口按 schema 兼容处理，导入不应因缺少该可选列而整批失败。
        delete item.ai_screening_done;
        delete item.website_email;
        delete item.website_phone;
        accepted.push({ ...item, status: "UNCLAIMED", followup_status: "WAITING_CONTACT", created_by: user.id, owner_id: user.id });
      } catch (reason) { failed += 1; errors.push(`第 ${index + 2} 行：${reason instanceof Error ? reason.message : "数据格式错误"}`); }
    });

    if (conflicts.length) {
      const { error: conflictError } = await supabase.from("customer_conflicts").insert(conflicts);
      // Production databases upgraded from the original schema may not yet
      // have the optional conflict table. Never lose a valid import because
      // of that: retain the same immutable conflict snapshot in audit_logs.
      if (conflictError) {
        const { error: auditConflictError } = await supabase.from("audit_logs").insert(conflicts.map((item) => ({
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
      const { data, error } = await supabase.from("customers").insert(chunk).select("id");
      if (error) { failed += chunk.length; errors.push(`第 ${offset + 2}-${offset + chunk.length + 1} 行：${error.message}`); continue; }
      success += data?.length || chunk.length;
      (data || []).forEach((item) => auditRows.push({ user_id: user.id, action: "CUSTOMER_IMPORT", target_type: "customer", target_id: item.id, content: { filename: payload.filename || "批量导入" }, created_at: new Date().toISOString() }));
    }
    if (auditRows.length) await supabase.from("audit_logs").insert(auditRows);
    const stats = { total_count: rows.length, success_count: success, duplicate_count: duplicate, failed_count: failed };
    const { data: task, error: taskError } = await supabase.from("import_tasks").insert({ filename: payload.filename || "批量导入", ...stats, created_by: user.id }).select("id").single();
    if (taskError) throw taskError;
    await supabase.from("audit_logs").insert({ user_id: user.id, action: "IMPORT_COMPLETE", target_type: "import_task", target_id: task.id, content: stats, created_at: new Date().toISOString() });
    return NextResponse.json({ ...stats, errors });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败，请稍后重试" }, { status: 400 }); }
}
