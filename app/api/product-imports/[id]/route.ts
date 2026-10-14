import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { PRODUCT_IMPORT_PARSER_VERSION } from "@/lib/product-import-version";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("pricebooks.import");
    const { id } = await context.params;
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(500, Math.max(10, Number(url.searchParams.get("page_size")) || 20));
    const status = url.searchParams.get("status") || "";
    const sheet = url.searchParams.get("sheet") || "";
    const admin = createAdminClient();
    const batch = await admin.from("product_import_batches").select("*").eq("id", id).single();
    if (batch.error) throw batch.error;
    let builder = admin.from("product_import_rows").select("*", { count: "exact" }).eq("batch_id", id);
    if (status) builder = builder.eq("status", status);
    if (sheet) builder = builder.eq("source_sheet", sheet);
    const rows = await builder.order("source_sheet").order("source_row").order("source_cell").order("source_variant").range((page - 1) * pageSize, page * pageSize - 1);
    if (rows.error) throw rows.error;
    const categories = await admin.from("product_categories").select("id,name_zh,product_family,is_active").order("sort_order").order("name_zh");
    if (categories.error) throw categories.error;
    const currentParser = batch.data.parser_version === PRODUCT_IMPORT_PARSER_VERSION && batch.data.summary?.parser_version === PRODUCT_IMPORT_PARSER_VERSION;
    return NextResponse.json({ batch: batch.data, data: rows.data || [], categories: categories.data || [], count: rows.count || 0, page, page_size: pageSize, can_edit: currentParser && hasPermission(account, "pricebooks.import"), can_publish: currentParser && hasPermission(account, "pricebooks.publish") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入批次加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
