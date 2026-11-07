import sharp from "sharp";
import { resolvePiRequirementAttachments } from "@/lib/orders/pi-requirement-attachment-view";
import type { createAdminClient } from "@/lib/supabase/admin";

export type StockExportRequirementImage = {
  id: string;
  filename: string;
  lineNumber: number | null;
  url: string;
  thumbnail: Uint8Array;
};

type AdminClient = ReturnType<typeof createAdminClient>;

export async function loadStockExportRequirementImages(admin: AdminClient, salesOrderIds: string[], requestUrl: string) {
  const ids = [...new Set(salesOrderIds.filter(Boolean))];
  const result = new Map<string, StockExportRequirementImage[]>();
  if (!ids.length) return result;
  const [{ data: attachments, error: attachmentError }, { data: items, error: itemError }] = await Promise.all([
    admin.from("attachments").select("id,sales_order_id,filename,mime_type,size_bytes,storage_path,sales_order_item_id,pi_line_number_snapshot,pi_product_label_snapshot")
      .in("sales_order_id", ids).in("kind", ["PI_ORDER_REQUIREMENT", "PI_LINE_REQUIREMENT"]).order("created_at"),
    admin.from("sales_order_items").select("id,sales_order_id,line_number,item_name,brand,model,quality").in("sales_order_id", ids),
  ]);
  if (attachmentError) throw attachmentError;
  if (itemError) throw itemError;

  const itemsByOrder = new Map<string, NonNullable<typeof items>>();
  for (const item of items || []) {
    const orderItems = itemsByOrder.get(item.sales_order_id) || [];
    orderItems.push(item);
    itemsByOrder.set(item.sales_order_id, orderItems);
  }
  for (const attachment of attachments || []) {
    const mapped = resolvePiRequirementAttachments([attachment], itemsByOrder.get(attachment.sales_order_id) || [])[0];
    if (mapped.archived) continue;
    if (!attachment.mime_type?.startsWith("image/")) continue;
    if (typeof attachment.size_bytes === "number" && attachment.size_bytes > 5 * 1024 * 1024) {
      throw new Error(`理货图片 ${attachment.filename} 超过 5MB，无法安全嵌入导出文件`);
    }
    const { data, error } = await admin.storage.from("crm-attachments").download(attachment.storage_path);
    if (error) throw error;
    const source = Buffer.from(await data.arrayBuffer());
    const thumbnail = await sharp(source, { limitInputPixels: 25_000_000 }).rotate()
      .resize(68, 44, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .jpeg({ quality: 70, chromaSubsampling: "4:2:0" }).toBuffer();
    const orderImages = result.get(attachment.sales_order_id) || [];
    orderImages.push({
      id: attachment.id,
      filename: attachment.filename,
      lineNumber: mapped.display_line_number,
      url: new URL(`/api/attachments/${attachment.id}?preview=1`, requestUrl).toString(),
      thumbnail: new Uint8Array(thumbnail),
    });
    result.set(attachment.sales_order_id, orderImages);
  }
  return result;
}
