import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewProductImportData } from "@/lib/product-import-review";
import { requireEditableProductImportBatch } from "@/lib/product-import-batch";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requirePermission("pricebooks.import");
    const { id } = await context.params;
    const body = await request.json();
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : [];
    if (!ids.length) return NextResponse.json({ error: "请选择需要处理的导入候选" }, { status: 400 });
    if (ids.length > 200) return NextResponse.json({ error: "单次最多处理200条，请分批操作" }, { status: 400 });
    if (!["SKIP", "CONFIRM", "SET_CATEGORY"].includes(body.action)) return NextResponse.json({ error: "批量操作无效" }, { status: 400 });

    const admin = createAdminClient();
    await requireEditableProductImportBatch(admin, id);
    const current = await admin.from("product_import_rows").select("id,status,source_sheet,normalized_data,issues").eq("batch_id", id).in("id", ids);
    if (current.error) throw current.error;
    if ((current.data || []).length !== ids.length) return NextResponse.json({ error: "所选候选已变化，请刷新后重试" }, { status: 409 });
    if ((current.data || []).some((row) => ["PUBLISHED", "SKIPPED"].includes(row.status)
      || row.issues?.some((issue: string) => issue.includes("原始整格尚有待核对内容")))) {
      return NextResponse.json({ error: "已发布、跳过或尚未完成拆分的整格不能批量处理" }, { status: 409 });
    }

    const batch = await admin.from("product_import_batches").select("summary").eq("id", id).single();
    if (batch.error) throw batch.error;
    const sheetModes = new Map((Array.isArray(batch.data.summary?.sheets) ? batch.data.summary.sheets : [])
      .map((sheet: { name: string; mode: string }) => [sheet.name, sheet.mode]));
    if (body.action === "SET_CATEGORY") {
      const category = await admin.from("product_categories").select("id,is_active").eq("id", String(body.category_id || "")).maybeSingle();
      if (category.error) throw category.error;
      if (!category.data?.is_active) return NextResponse.json({ error: "请选择有效且已启用的商品分类" }, { status: 400 });
    }

    const changes: Array<Record<string, unknown>> = [];
    for (const row of current.data || []) {
      const base = { id: row.id, expected_status: row.status };
      if (body.action === "SKIP") {
        changes.push({ ...base, status: "SKIPPED" });
      } else if (body.action === "SET_CATEGORY") {
        const previous = row.normalized_data && typeof row.normalized_data === "object" ? row.normalized_data : {};
        const normalized = { ...previous, category_id: body.category_id,
          specifications: previous.category_id === body.category_id ? previous.specifications || {} : {} };
        changes.push({ ...base, normalized_data: normalized, status: "REVIEW",
          issues: ["已设置商品分类；请逐项核对原始单元格与可交付规格"] });
      } else if (sheetModes.get(row.source_sheet) === "TABULAR") {
        const { normalized, issues } = await reviewProductImportData(admin, row.normalized_data);
        if (!issues.length) changes.push({ ...base, normalized_data: normalized, status: "VALID", issues: [] });
      }
    }
    if (!changes.length) return NextResponse.json({ updated: 0, requested: ids.length });
    const { data, error } = await admin.rpc("apply_product_import_review", {
      p_batch_id: id, p_actor_id: user.id, p_changes: changes,
    });
    if (error) throw error;
    return NextResponse.json({ updated: data.updated, requested: ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量处理失败";
    return NextResponse.json({ error: message }, { status: message.includes("状态已变化") || message.includes("批次") ? 409 : authErrorStatus(message) || 500 });
  }
}
