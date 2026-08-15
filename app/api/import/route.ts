import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

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
    const payload = await request.json() as { filename?: string; rows?: Row[] };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) return NextResponse.json({ error: "没有可导入的数据" }, { status: 400 });

    // 一次预取现有客户，避免逐条请求导致导入卡顿或超时。
    const { data: existing, error: existingError } = await supabase.from("customers").select("company_name,phone,email").is("deleted_at", null).limit(10000);
    if (existingError) throw existingError;
    const seen = new Set<string>();
    (existing || []).forEach((row) => identity(row as Row).keys.forEach((key) => seen.add(key)));
    const accepted: Row[] = []; let duplicate = 0; let failed = 0; const errors: string[] = [];
    rows.forEach((raw, index) => {
      const item = { ...raw };
      if ("rating" in item) item.rating = bounded(item.rating, 0, 5);
      if ("ai_score" in item) item.ai_score = bounded(item.ai_score, 0, 100);
      const current = identity(item);
      try {
        if (!current.name) throw new Error("客户名称为空");
        if (![item.phone, item.email, item.website, item.google_url].some((value) => text(value))) throw new Error("缺少电话、邮箱、官网或 Google 地图联系方式");
        if (current.keys.some((key) => seen.has(key))) { duplicate += 1; return; }
        current.keys.forEach((key) => seen.add(key));
        delete item.import_meta;
        // 兼容旧版 customers 表：AI 筛选状态列由筛选接口按 schema 兼容处理，导入不应因缺少该可选列而整批失败。
        delete item.ai_screening_done;
        delete item.website_email;
        delete item.website_phone;
        accepted.push({ ...item, created_by: user.id, owner_id: user.id });
      } catch (reason) { failed += 1; errors.push(`第 ${index + 2} 行：${reason instanceof Error ? reason.message : "数据格式错误"}`); }
    });

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
