import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { storageObjectName } from "@/lib/storage-object-key";
import { isPiRequirementImage, PI_REQUIREMENT_IMAGE_LIMIT } from "@/lib/pi-requirement-image";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requireUser();
    if (!hasPermission(account, "orders.edit")) throw new Error("FORBIDDEN");
    const { id: orderId } = await params;
    const admin = createAdminClient();
    const orderResult = await admin.from("sales_orders")
      .select("id,customer_id,prepared_by,sales_user_id,confirmation_method,status")
      .eq("id", orderId).maybeSingle();
    if (orderResult.error) throw orderResult.error;
    const order = orderResult.data;
    if (!order || order.confirmation_method !== "DIRECT_PI"
      || (order.prepared_by || order.sales_user_id) !== account.id) throw new Error("FORBIDDEN");
    if (order.status !== "DRAFT") throw new Error("仅 PI 草稿可补充理货要求图片；已提交订单请走变更流程");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !imageTypes.has(file.type) || file.size <= 0
      || file.size > PI_REQUIREMENT_IMAGE_LIMIT) throw new Error("请选择不超过 15MB 的 JPG、PNG 或 WebP 图片");
    const content = Buffer.from(await file.arrayBuffer());
    if (!isPiRequirementImage(content, file.type)) throw new Error("图片内容与文件类型不符，请重新选择原始图片");
    const lineValue = String(form.get("line_number") || "").trim();
    const lineNumber = lineValue === "" ? null : Number(lineValue);
    if (lineNumber !== null && (!Number.isSafeInteger(lineNumber) || lineNumber < 1)) throw new Error("产品行号无效");
    const lineResult = lineNumber === null ? null : await admin.from("sales_order_items")
      .select("id,line_number,item_name,brand,model,quality").eq("sales_order_id", orderId).eq("line_number", lineNumber).maybeSingle();
    if (lineResult?.error) throw lineResult.error;
    if (lineNumber !== null && !lineResult?.data) throw new Error("产品行不存在，请刷新 PI 后重试");

    const attachmentId = crypto.randomUUID();
    const storagePath = `${account.id}/pi-requirements/${orderId}/${storageObjectName(attachmentId, file.type)}`;
    const uploaded = await admin.storage.from("crm-attachments")
      .upload(storagePath, content, { contentType: file.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    const inserted = await admin.from("attachments").insert({
      id: attachmentId, customer_id: order.customer_id, sales_order_id: orderId,
      sales_order_item_id: lineResult?.data?.id || null, pi_line_number_snapshot: lineNumber,
      pi_product_label_snapshot: lineResult?.data ? [lineResult.data.item_name, lineResult.data.brand,
        lineResult.data.model, lineResult.data.quality].map((value) => String(value || "").trim()).join(" · ") : null,
      uploaded_by: account.id, filename: file.name, original_filename: file.name,
      storage_path: storagePath, mime_type: file.type, size_bytes: file.size,
      kind: lineNumber === null ? "PI_ORDER_REQUIREMENT" : "PI_LINE_REQUIREMENT",
    }).select("id,filename,mime_type,size_bytes,created_at,pi_line_number_snapshot").single();
    if (inserted.error) {
      await admin.storage.from("crm-attachments").remove([storagePath]);
      throw inserted.error;
    }
    return NextResponse.json(inserted.data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "理货要求图片上传失败";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
