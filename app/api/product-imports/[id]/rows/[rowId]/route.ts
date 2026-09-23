import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewProductImportData } from "@/lib/product-import-review";
import { requireEditableProductImportBatch } from "@/lib/product-import-batch";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const { user } = await requirePermission("pricebooks.import");
    const { id, rowId } = await context.params;
    const body = await request.json();
    const admin = createAdminClient();
    await requireEditableProductImportBatch(admin, id);
    const current = await admin.from("product_import_rows").select("id,status").eq("id", rowId).eq("batch_id", id).single();
    if (current.error) throw current.error;
    if (current.data.status === "PUBLISHED" || current.data.status === "SKIPPED") {
      return NextResponse.json({ error: "已发布或已跳过的来源行不能修改" }, { status: 409 });
    }
    let change: Record<string, unknown> = {
      id: rowId, expected_status: current.data.status,
      status: "SKIPPED", confirm_split_complete: body.confirm_split_complete === true,
    };
    if (body.action !== "SKIP") {
      const { normalized, issues } = await reviewProductImportData(admin, body.normalized_data);
      change = { id: rowId, expected_status: current.data.status,
        status: issues.length ? "REVIEW" : "VALID", normalized_data: normalized, issues };
    }
    const { data, error } = await admin.rpc("apply_product_import_review", {
      p_batch_id: id, p_actor_id: user.id, p_changes: [change],
    });
    if (error) throw error;
    return NextResponse.json({ updated: data.updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入行保存失败";
    return NextResponse.json({ error: message }, { status: message.includes("状态已变化") || message.includes("批次") ? 409 : authErrorStatus(message) || 500 });
  }
}
