import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseProductWorkbook } from "@/lib/product-import";
import type { ProductImportCandidate } from "@/lib/product-import";
import { refreshProductImportBatchCounts } from "@/lib/product-import-batch";
import { PRODUCT_IMPORT_PARSER_VERSION } from "@/lib/product-import-version";

export const runtime = "nodejs";

async function resolveProductOnlyCategories(admin: ReturnType<typeof createAdminClient>, candidates: ProductImportCandidate[]) {
  const codes = [...new Set(candidates.filter((row) => row.normalized_data.import_mode === "PRODUCT_ONLY")
    .map((row) => row.normalized_data.category_code?.trim().toUpperCase()).filter((code): code is string => Boolean(code)))];
  if (!codes.length) return;
  const { data, error } = await admin.from("product_categories").select("id,code,is_active").in("code", codes);
  if (error) throw error;
  const byCode = new Map((data || []).map((category) => [category.code.toUpperCase(), category]));
  for (const row of candidates) {
    if (row.normalized_data.import_mode !== "PRODUCT_ONLY") continue;
    const code = row.normalized_data.category_code?.trim().toUpperCase() || "";
    const category = byCode.get(code);
    if (!category?.is_active) {
      row.issues.push(code ? `分类编码 ${code} 不存在或已停用，请逐行选定有效分类` : "缺少商品分类编码，请逐行选定有效分类");
      continue;
    }
    row.normalized_data.category_id = category.id;
    row.issues = row.issues.filter((issue) => !issue.includes("请选择商品分类"));
  }
}

export async function GET(request: Request) {
  try {
    const { account } = await requirePermission("pricebooks.import");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(500, Math.max(10, Number(url.searchParams.get("page_size")) || 20));
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
    const existing = await admin.from("product_import_batches").select("id,status,file_name,candidate_count").eq("file_sha256", sha256).eq("parser_version", PRODUCT_IMPORT_PARSER_VERSION).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const existingBatch = existing.data;
      const rows = await admin.from("product_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", existingBatch.id);
      if (rows.error) throw rows.error;
      if (rows.count !== existingBatch.candidate_count) {
        if (!["FAILED", "REVIEW", "READY"].includes(existingBatch.status)) return NextResponse.json({ error: "该批次正在发布或已结束，不能续传来源行" }, { status: 409 });
        const reparsed = parseProductWorkbook(buffer);
        await resolveProductOnlyCategories(admin, reparsed.candidates);
        if (reparsed.candidates.length !== existingBatch.candidate_count) return NextResponse.json({ error: "同版解析所得记录数与原批次不一致，已禁止自动续传" }, { status: 409 });
        const locked = await admin.from("product_import_batches").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", existingBatch.id).in("status", ["FAILED", "REVIEW", "READY"]).select("id").maybeSingle();
        if (locked.error) throw locked.error;
        if (!locked.data) return NextResponse.json({ error: "批次状态已变化，请刷新后再试" }, { status: 409 });
        for (let offset = 0; offset < reparsed.candidates.length; offset += 300) {
          const chunk = reparsed.candidates.slice(offset, offset + 300).map((row) => ({ ...row, batch_id: existingBatch.id }));
          const { error } = await admin.from("product_import_rows").upsert(chunk, { onConflict: "batch_id,source_sheet,source_row,source_cell,source_variant", ignoreDuplicates: true });
          if (error) throw error;
        }
        const saved = await admin.from("product_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", existingBatch.id);
        if (saved.error) throw saved.error;
        if (saved.count !== reparsed.candidates.length) throw new Error("来源行续传后仍不完整，批次保持锁定");
        await writeAudit(supabase, user.id, "PRODUCT_PRICEBOOK_IMPORT_RECOVER", "product_import_batch", existingBatch.id, { file_name: file.name, sha256, recovered_rows: reparsed.candidates.length - (rows.count || 0) });
      }
      if (existingBatch.status === "FAILED" || rows.count !== existingBatch.candidate_count) await refreshProductImportBatchCounts(admin, existingBatch.id);
      const refreshed = await admin.from("product_import_batches").select("*").eq("id", existingBatch.id).single();
      if (refreshed.error) throw refreshed.error;
      return NextResponse.json({ data: refreshed.data, duplicate: true, recovered: rows.count !== existingBatch.candidate_count }, { status: 200 });
    }
    const parsed = parseProductWorkbook(buffer);
    await resolveProductOnlyCategories(admin, parsed.candidates);
    if (!parsed.candidates.length) return NextResponse.json({ error: "未识别到可核对的商品或数字线索；原表不会被写入正式商品库" }, { status: 422 });
    const validCount = parsed.candidates.filter((row) => row.status === "VALID").length;
    const reviewCount = parsed.candidates.filter((row) => row.status === "REVIEW").length;
    const errorCount = parsed.candidates.filter((row) => row.status === "ERROR").length;
    const uncoveredSheets = parsed.sheets.filter((sheet) => sheet.mode === "MATRIX" || (sheet.mode === "EMPTY" && sheet.source_rows > 0) || (sheet.unparsed_cells || 0) > 0).map((sheet) => sheet.name);
    const { data: batch, error: batchError } = await admin.from("product_import_batches").insert({
      file_name: file.name.slice(0, 255), file_sha256: sha256, parser_version: PRODUCT_IMPORT_PARSER_VERSION, source_name: String(form.get("source_name") || "产品报价表").slice(0, 120),
      // A later insert chunk can fail after earlier chunks succeed. Keep the
      // batch unavailable until all candidate rows have been persisted.
      status: "FAILED", sheet_count: parsed.sheet_count, source_row_count: parsed.source_row_count,
      candidate_count: parsed.candidates.length, valid_count: validCount, review_count: reviewCount, error_count: errorCount,
      summary: { parser_version: PRODUCT_IMPORT_PARSER_VERSION, sheets: parsed.sheets, uncovered_sheets: uncoveredSheets }, created_by: user.id,
    }).select("*").single();
    if (batchError) throw batchError;
    for (let offset = 0; offset < parsed.candidates.length; offset += 300) {
      const chunk = parsed.candidates.slice(offset, offset + 300).map((row) => ({ ...row, batch_id: batch.id }));
      const { error } = await admin.from("product_import_rows").insert(chunk);
      if (error) throw error;
    }
    const { count: savedCount, error: countError } = await admin.from("product_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batch.id);
    if (countError) throw countError;
    if (savedCount !== parsed.candidates.length) throw new Error("来源行保存数量不一致，批次已锁定，禁止发布");
    const finalStatus = reviewCount || errorCount || uncoveredSheets.length ? "REVIEW" : "READY";
    const { data: completedBatch, error: completeError } = await admin.from("product_import_batches").update({ status: finalStatus }).eq("id", batch.id).eq("status", "FAILED").select("*").single();
    if (completeError) throw completeError;
    await writeAudit(supabase, user.id, "PRODUCT_PRICEBOOK_IMPORT", "product_import_batch", batch.id, { file_name: file.name, sha256, sheets: parsed.sheet_count, source_rows: parsed.source_row_count, candidates: parsed.candidates.length, valid: validCount, review: reviewCount, errors: errorCount });
    return NextResponse.json({ data: completedBatch, duplicate: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "产品报价表解析失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
