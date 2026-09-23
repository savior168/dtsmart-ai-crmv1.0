import { createAdminClient } from "@/lib/supabase/admin";
import { PRODUCT_IMPORT_PARSER_VERSION } from "@/lib/product-import-version";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function requireEditableProductImportBatch(admin: AdminClient, batchId: string) {
  const { data, error } = await admin.from("product_import_batches").select("id,status,parser_version,summary").eq("id", batchId).single();
  if (error) throw error;
  if (data && (data.parser_version !== PRODUCT_IMPORT_PARSER_VERSION || data.summary?.parser_version !== PRODUCT_IMPORT_PARSER_VERSION)) {
    throw new Error("该批次使用旧版解析坐标，请重新上传原文件后核对");
  }
  if (!data || !["REVIEW", "READY"].includes(data.status)) {
    throw new Error("导入批次尚未完整保存、正在发布或已结束，不能修改来源行");
  }
}

export async function refreshProductImportBatchCounts(admin: AdminClient, batchId: string) {
  const { data, error } = await admin.rpc("refresh_product_import_batch_counts", { p_batch_id: batchId });
  if (error) throw error;
  if (!data?.complete) throw new Error("来源行尚未完整保存，请重新上传同一文件续传后再核对");
}
