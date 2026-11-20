import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { storageObjectName } from "@/lib/storage-object-key";
import { isPiRequirementImage } from "@/lib/pi-requirement-image";
import { assertSupplierRoleAllowed } from "@/lib/auth/supplier-role-boundary";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_LIMIT = 5 * 1024 * 1024;
const NOTE_IMAGE_LIMIT = 10;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const uploadedPaths: string[] = [];
  const insertedIds: string[] = [];
  try {
    const { supabase, account } = await requirePermission("stock.update");
    assertSupplierRoleAllowed(account.role);
    if (!hasPermission(account, "stock.procurement.edit")
      || !hasPermission(account, "supplier.documents.manage")) throw new Error("FORBIDDEN");
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
    const replaceId = typeof form.get("replace_attachment_id") === "string" ? String(form.get("replace_attachment_id")) : "";
    const replaceReason = typeof form.get("replace_reason") === "string" ? String(form.get("replace_reason")).trim() : "";
    const expectedUpdatedAt = typeof form.get("expected_updated_at") === "string" ? String(form.get("expected_updated_at")) : "";
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length || files.length > NOTE_IMAGE_LIMIT) throw new Error(`请选择1至${NOTE_IMAGE_LIMIT}张送货单照片`);
    if (replaceId) {
      if (!/^[0-9a-f-]{36}$/i.test(replaceId) || files.length !== 1
        || replaceReason.length < 2 || replaceReason.length > 500
        || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new Error("请选择一张替代照片并填写更换原因");
      const old = await admin.from("attachments").select("id").eq("id", replaceId)
        .eq("supplier_delivery_note_id", id).is("supplier_photo_superseded_at", null).maybeSingle();
      if (old.error) throw old.error;
      if (!old.data) throw new Error("原照片已变更，请刷新后重试");
    }
    if (files.some((file) => !IMAGE_TYPES.has(file.type) || file.size > IMAGE_LIMIT)) {
      throw new Error("每张照片须为不超过5MB的JPG、PNG或WebP图片");
    }
    const prior = await admin.from("attachments").select("id", { count: "exact", head: true })
      .eq("supplier_delivery_note_id", id).is("supplier_photo_superseded_at", null);
    if (prior.error) throw prior.error;
    if ((prior.count || 0) + files.length - (replaceId ? 1 : 0) > NOTE_IMAGE_LIMIT) {
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
        mime_type: file.type, size_bytes: file.size, kind: "SUPPLIER_DELIVERY_NOTE",
        supplier_photo_replaces_id: replaceId || null });
    }
    const inserted = await admin.from("attachments").insert(rows)
      .select("id,filename,mime_type,size_bytes,created_at,supplier_delivery_note_id");
    if (inserted.error) throw inserted.error;
    insertedIds.push(...(inserted.data || []).map((row) => row.id));
    if (replaceId) {
      const correction = await supabase.rpc("supersede_supplier_delivery_note_photo", {
        p_delivery_note_id: id, p_old_attachment_id: replaceId,
        p_new_attachment_id: insertedIds[0], p_expected_updated_at: expectedUpdatedAt,
        p_reason: replaceReason,
      });
      if (correction.error) throw correction.error;
    }
    return NextResponse.json({ data: inserted.data || [] }, { status: 201 });
  } catch (error) {
    if (insertedIds.length) await createAdminClient().from("attachments").delete().in("id", insertedIds);
    if (uploadedPaths.length) await createAdminClient().storage.from("crm-attachments").remove(uploadedPaths);
    const message = error instanceof Error ? error.message : "送货单照片上传失败";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
