import { NextResponse } from "next/server";
import { hasPermission, requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

async function access(id: string) {
  const { account } = await requireUser();
  const admin = createAdminClient();
  const { data: attachment, error } = await admin.from("attachments").select("id,customer_id,uploaded_by,followup_id,quote_id,stock_order_id,filename,storage_path,mime_type").eq("id", id).single();
  if (error || !attachment) throw error || new Error("附件不存在");

  let allowed = account.role === "ADMIN";
  if (attachment.customer_id) {
    const customer = await admin.from("customers").select("owner_id").eq("id", attachment.customer_id).single();
    allowed ||= customer.data?.owner_id === account.id || hasPermission(account, "customers.data_all");
  }
  if (attachment.quote_id) {
    const quote = await admin.from("quotes").select("owner_id").eq("id", attachment.quote_id).single();
    allowed ||= quote.data?.owner_id === account.id || hasPermission(account, "quotes.data_all");
  }
  if (attachment.stock_order_id) {
    const stock = await admin.from("stock_orders").select("sales_user_id").eq("id", attachment.stock_order_id).single();
    allowed ||= stock.data?.sales_user_id === account.id || hasPermission(account, "stock.data_all") || account.role === "WAREHOUSE";
  }
  if (attachment.followup_id && !attachment.customer_id) {
    const followup = await admin.from("followups").select("customer:customers!inner(owner_id)").eq("id", attachment.followup_id).single();
    const customer = Array.isArray(followup.data?.customer) ? followup.data?.customer[0] : followup.data?.customer;
    allowed ||= customer?.owner_id === account.id || hasPermission(account, "followups.data_all");
  }
  if (!allowed) throw new Error("FORBIDDEN");
  return { account, admin, attachment };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { admin, attachment } = await access(id);
    const download = await admin.storage.from("crm-attachments").download(attachment.storage_path);
    if (download.error) throw download.error;
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    return new NextResponse(download.data, { headers: {
      "Content-Type": attachment.mime_type || "application/octet-stream",
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "附件下载失败";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { account, admin, attachment } = await access(id);
    if (attachment.uploaded_by !== account.id && account.role !== "ADMIN") throw new Error("只能删除本人上传的附件");
    if (attachment.quote_id) {
      const quote = await admin.from("quotes").select("status").eq("id", attachment.quote_id).single();
      if (quote.error) throw quote.error;
      if (!["DRAFT", "GENERATED"].includes(quote.data.status)) throw new Error("报价发送后附件作为业务凭证保留，不能删除");
    }
    const removed = await admin.storage.from("crm-attachments").remove([attachment.storage_path]);
    if (removed.error) throw removed.error;
    const deleted = await admin.from("attachments").delete().eq("id", id);
    if (deleted.error) throw deleted.error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "附件删除失败";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
