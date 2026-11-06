import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { storageObjectName } from "@/lib/storage-object-key";
import { isPiRequirementImage } from "@/lib/pi-requirement-image";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_LIMIT = 5 * 1024 * 1024;
const NOTE_IMAGE_LIMIT = 10;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const uploadedPaths: string[] = [];
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (!hasPermission(account, "stock.procurement.edit")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("送货单记录无效");

    const admin = createAdminClient();
    const noteResult = await admin.from("supplier_delivery_notes").select("id,note_number,supplier_id")
      .eq("id", id).maybeSingle();
    if (noteResult.error) throw noteResult.error;
    if (!noteResult.data) throw new Error("送货单记录不存在");
    const allocationResult = await admin.from("supplier_receipt_allocations")
      .select("stock_order_item_id").eq("delivery_note_id", id);
    if (allocationResult.error) throw allocationResult.error;
    const itemIds = [...new Set((allocationResult.data || []).map((row) => row.stock_order_item_id))];
    if (!itemIds.length) throw new Error("该送货单尚无有效的备货产品关联，暂不能上传凭证");
    // Use the caller-scoped client to prove access to at least one linked stock
    // order before the service client is allowed to write its shared document.
    const visibleItems = await supabase.from("stock_order_items").select("id")
      .in("id", itemIds).limit(1);
    if (visibleItems.error) throw visibleItems.error;
    if (!visibleItems.data?.length) throw new Error("FORBIDDEN");

    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length || files.length > NOTE_IMAGE_LIMIT) throw new Error(`请选择1至${NOTE_IMAGE_LIMIT}张送货单照片`);
    if (files.some((file) => !IMAGE_TYPES.has(file.type) || file.size > IMAGE_LIMIT)) {
      throw new Error("每张照片须为不超过5MB的JPG、PNG或WebP图片");
    }
    const prior = await admin.from("attachments").select("id", { count: "exact", head: true })
      .eq("supplier_delivery_note_id", id);
    if (prior.error) throw prior.error;
    if ((prior.count || 0) + files.length > NOTE_IMAGE_LIMIT) {
      throw new Error(`该送货单最多保存${NOTE_IMAGE_LIMIT}张照片（每张不超过5MB）`);
    }

    const rows = [];
    for (const file of files) {
      const content = Buffer.from(await file.arrayBuffer());
      if (!isPiRequirementImage(content, file.type)) throw new Error(`文件“${file.name}”内容与图片格式不符`);
      const attachmentId = crypto.randomUUID();
      const storagePath = `${account.id}/supplier-delivery-notes/${id}/${storageObjectName(attachmentId, file.type)}`;
      const upload = await admin.storage.from("crm-attachments").upload(storagePath, content,
        { contentType: file.type, upsert: false });
      if (upload.error) throw upload.error;
      uploadedPaths.push(storagePath);
      rows.push({ id: attachmentId, supplier_delivery_note_id: id, uploaded_by: account.id,
        filename: file.name.slice(0, 240), original_filename: file.name.slice(0, 240), storage_path: storagePath,
        mime_type: file.type, size_bytes: file.size, kind: "SUPPLIER_DELIVERY_NOTE" });
    }
    const inserted = await admin.from("attachments").insert(rows)
      .select("id,filename,mime_type,size_bytes,created_at,supplier_delivery_note_id");
    if (inserted.error) throw inserted.error;
    return NextResponse.json({ data: inserted.data || [] }, { status: 201 });
  } catch (error) {
    if (uploadedPaths.length) await createAdminClient().storage.from("crm-attachments").remove(uploadedPaths);
    const message = error instanceof Error ? error.message : "送货单照片上传失败";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
