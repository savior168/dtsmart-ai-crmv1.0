import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission, requireUser } from "@/lib/auth/current-user";
import { storageObjectName } from "@/lib/storage-object-key";

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"]);

export async function POST(request: NextRequest) {
  try {
    const { account } = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择附件" }, { status: 400 });
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "附件必须小于15MB" }, { status: 400 });
    if (!allowed.has(file.type)) return NextResponse.json({ error: "仅支持图片、PDF、Excel和Word附件" }, { status: 400 });
    const followupId = String(form.get("followup_id") || "");
    const quoteId = String(form.get("quote_id") || "");
    if (!followupId && !quoteId) return NextResponse.json({ error: "附件缺少关联记录" }, { status: 400 });
    const admin = createAdminClient();
    let customerId: string | null = null;
    if (followupId) {
      if (!hasPermission(account, "followups.edit")) throw new Error("FORBIDDEN");
      const { data } = await admin.from("followups").select("id,user_id,customer_id,customer:customers!inner(owner_id)").eq("id", followupId).maybeSingle();
      const customer = Array.isArray(data?.customer) ? data?.customer[0] : data?.customer;
      if (!data || (account.role !== "ADMIN" && (data.user_id !== account.id || customer?.owner_id !== account.id))) throw new Error("仅当前归属销售员可上传本人跟进的附件");
      customerId = data.customer_id;
    }
    if (quoteId) {
      if (!hasPermission(account, "quotes.edit")) throw new Error("FORBIDDEN");
      const { data } = await admin.from("quotes").select("id,owner_id,customer_id,status").eq("id", quoteId).maybeSingle();
      if (!data || (data.owner_id !== account.id && account.role !== "ADMIN")) throw new Error("只能上传本人报价附件");
      if (!["DRAFT", "GENERATED", "SENT"].includes(data.status)) throw new Error("当前报价状态不能新增附件");
      customerId = data.customer_id;
    }
    const id = crypto.randomUUID();
    const storagePath = `${account.id}/${quoteId ? `quotes/${quoteId}` : `followups/${followupId}`}/${storageObjectName(id, file.type)}`;
    const upload = await admin.storage.from("crm-attachments").upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;
    const inserted = await admin.from("attachments").insert({ id, customer_id: customerId, followup_id: followupId || null, quote_id: quoteId || null, uploaded_by: account.id, filename: file.name, original_filename: file.name, storage_path: storagePath, mime_type: file.type, size_bytes: file.size, kind: quoteId ? "QUOTE" : "FOLLOWUP" }).select("id,filename,mime_type,size_bytes,created_at").single();
    if (inserted.error) {
      await admin.storage.from("crm-attachments").remove([storagePath]);
      throw inserted.error;
    }
    return NextResponse.json(inserted.data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "附件上传失败";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
