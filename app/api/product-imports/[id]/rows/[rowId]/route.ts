import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNormalizedProduct } from "@/lib/product-import";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const { supabase, user } = await requirePermission("pricebooks.import");
    const { id, rowId } = await context.params;
    const body = await request.json();
    const admin = createAdminClient();
    const current = await admin.from("product_import_rows").select("id,status").eq("id", rowId).eq("batch_id", id).single();
    if (current.error) throw current.error;
    if (current.data.status === "PUBLISHED") return NextResponse.json({ error: "已发布的来源行不能修改" }, { status: 409 });
    if (body.action === "SKIP") {
      const { data, error } = await admin.from("product_import_rows").update({ status: "SKIPPED", issues: [], updated_at: new Date().toISOString() }).eq("id", rowId).select("*").single();
      if (error) throw error;
      await refreshBatch(admin, id);
      await writeAudit(supabase, user.id, "PRODUCT_IMPORT_ROW_SKIP", "product_import_row", rowId, { batch_id: id });
      return NextResponse.json({ data });
    }
    const { normalized, issues } = validateNormalizedProduct(body.normalized_data);
    const status = issues.length ? "REVIEW" : "VALID";
    const { data, error } = await admin.from("product_import_rows").update({ normalized_data: normalized, status, issues, updated_at: new Date().toISOString() }).eq("id", rowId).select("*").single();
    if (error) throw error;
    await refreshBatch(admin, id);
    await writeAudit(supabase, user.id, "PRODUCT_IMPORT_ROW_REVIEW", "product_import_row", rowId, { batch_id: id, status, issues });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入行保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}

async function refreshBatch(admin: ReturnType<typeof createAdminClient>, batchId: string) {
  const { data, error } = await admin.from("product_import_rows").select("status").eq("batch_id", batchId);
  if (error) throw error;
  const counts = { valid: 0, review: 0, error: 0 };
  for (const row of data || []) {
    if (row.status === "VALID") counts.valid += 1;
    if (row.status === "REVIEW") counts.review += 1;
    if (row.status === "ERROR") counts.error += 1;
  }
  await admin.from("product_import_batches").update({ valid_count: counts.valid, review_count: counts.review, error_count: counts.error, status: counts.review || counts.error ? "REVIEW" : "READY", updated_at: new Date().toISOString() }).eq("id", batchId).neq("status", "PUBLISHED");
}
