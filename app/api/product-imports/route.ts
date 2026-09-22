import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseProductWorkbook } from "@/lib/product-import";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { account } = await requirePermission("pricebooks.import");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get("page_size")) || 20));
    const admin = createAdminClient();
    const { data, count, error } = await admin.from("product_import_batches").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    return NextResponse.json({ data: data || [], count: count || 0, page, page_size: pageSize, can_import: hasPermission(account, "pricebooks.import"), can_publish: hasPermission(account, "pricebooks.publish") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入批次加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requirePermission("pricebooks.import");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择Excel报价表" }, { status: 400 });
    if (!/\.(xlsx|xls)$/i.test(file.name)) return NextResponse.json({ error: "只支持.xlsx或.xls文件" }, { status: 400 });
    if (file.size <= 0 || file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "文件不能为空且不得超过20MB" }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const admin = createAdminClient();
    const existing = await admin.from("product_import_batches").select("id,status,file_name").eq("file_sha256", sha256).maybeSingle();
    if (existing.data) return NextResponse.json({ data: existing.data, duplicate: true }, { status: 200 });
    const parsed = parseProductWorkbook(buffer);
    if (!parsed.candidates.length) return NextResponse.json({ error: "未识别到任何带价格的商品候选；原表不会被写入正式商品库" }, { status: 422 });
    const validCount = parsed.candidates.filter((row) => row.status === "VALID").length;
    const reviewCount = parsed.candidates.filter((row) => row.status === "REVIEW").length;
    const errorCount = parsed.candidates.filter((row) => row.status === "ERROR").length;
    const { data: batch, error: batchError } = await admin.from("product_import_batches").insert({
      file_name: file.name.slice(0, 255), file_sha256: sha256, source_name: String(form.get("source_name") || "产品报价表").slice(0, 120),
      status: reviewCount || errorCount ? "REVIEW" : "READY", sheet_count: parsed.sheet_count, source_row_count: parsed.source_row_count,
      candidate_count: parsed.candidates.length, valid_count: validCount, review_count: reviewCount, error_count: errorCount,
      summary: { sheets: parsed.sheets }, created_by: user.id,
    }).select("*").single();
    if (batchError) throw batchError;
    for (let offset = 0; offset < parsed.candidates.length; offset += 300) {
      const chunk = parsed.candidates.slice(offset, offset + 300).map((row) => ({ ...row, batch_id: batch.id }));
      const { error } = await admin.from("product_import_rows").insert(chunk);
      if (error) throw error;
    }
    await writeAudit(supabase, user.id, "PRODUCT_PRICEBOOK_IMPORT", "product_import_batch", batch.id, { file_name: file.name, sha256, sheets: parsed.sheet_count, source_rows: parsed.source_row_count, candidates: parsed.candidates.length, valid: validCount, review: reviewCount, errors: errorCount });
    return NextResponse.json({ data: batch, duplicate: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "产品报价表解析失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
