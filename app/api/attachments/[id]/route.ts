import { NextResponse } from "next/server";
import { hasPermission, requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

async function access(id: string) {
  const { account, supabase } = await requireUser();
  const admin = createAdminClient();
  const { data: attachment, error } = await admin.from("attachments").select("id,customer_id,uploaded_by,followup_id,quote_id,stock_order_id,sales_order_id,supplier_delivery_note_id,filename,storage_path,mime_type").eq("id", id).single();
  if (error || !attachment) throw error || new Error("附件不存在");

  let allowed = account.role === "ADMIN";
  async function canReadOwner(ownerId: string | null | undefined) {
    if (!ownerId) return false;
    if (ownerId === account.id || account.role === "ADMIN") return true;
    if (account.role !== "SUPERVISOR" || !account.supervisor_can_view_subordinates) return false;
    const direct = await admin.from("users").select("id").eq("id", ownerId).eq("manager_id", account.id).eq("status", "ACTIVE").maybeSingle();
    return Boolean(direct.data);
  }
  if (attachment.customer_id) {
    const customer = await admin.from("customers").select("owner_id").eq("id", attachment.customer_id).single();
    allowed ||= await canReadOwner(customer.data?.owner_id);
  }
  if (attachment.quote_id) {
    const quote = await admin.from("quotes").select("owner_id").eq("id", attachment.quote_id).single();
    allowed ||= await canReadOwner(quote.data?.owner_id);
  }
  if (attachment.stock_order_id) {
    const stock = await admin.from("stock_orders").select("sales_user_id").eq("id", attachment.stock_order_id).single();
    allowed ||= await canReadOwner(stock.data?.sales_user_id) || account.role === "WAREHOUSE";
  }
  if (attachment.sales_order_id) {
    const order = await admin.from("sales_orders").select("sales_user_id,prepared_by").eq("id", attachment.sales_order_id).single();
    if (order.error) throw order.error;
    allowed ||= Boolean(hasPermission(account, "orders.view")
      && (order.data.prepared_by === account.id || await canReadOwner(order.data.sales_user_id)));
    if (account.role === "WAREHOUSE" && hasPermission(account, "stock.view")) {
      const stock = await admin.from("stock_orders").select("id,status")
        .eq("sales_order_id", attachment.sales_order_id).maybeSingle();
      if (stock.error) throw stock.error;
      allowed ||= Boolean(stock.data && stock.data.status !== "DRAFT");
    }
  }
  if (attachment.supplier_delivery_note_id) {
    allowed ||= hasPermission(account, "supplier.reconciliation.view");
    if (!allowed && hasPermission(account, "stock.view")) {
      const allocations = await admin.from("supplier_receipt_allocations").select("stock_order_item_id")
        .eq("delivery_note_id", attachment.supplier_delivery_note_id);
      if (allocations.error) throw allocations.error;
      const itemIds = [...new Set((allocations.data || []).map((row) => row.stock_order_item_id))];
      if (itemIds.length) {
        const visible = await supabase.from("stock_order_items").select("id")
          .in("id", itemIds).limit(1);
        if (visible.error) throw visible.error;
        allowed ||= Boolean(visible.data?.length);
      }
    }
  }
  if (attachment.followup_id && !attachment.customer_id) {
    const followup = await admin.from("followups").select("customer:customers!inner(owner_id)").eq("id", attachment.followup_id).single();
    const customer = Array.isArray(followup.data?.customer) ? followup.data?.customer[0] : followup.data?.customer;
    allowed ||= await canReadOwner(customer?.owner_id);
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
    if (attachment.supplier_delivery_note_id) throw new Error("送货单照片为供应商对账凭证，不可删除；如需更正请补传清晰版本并保留原件");
    if (attachment.uploaded_by !== account.id && account.role !== "ADMIN") throw new Error("只能删除本人上传的附件");
    if (attachment.quote_id) {
      const quote = await admin.from("quotes").select("status").eq("id", attachment.quote_id).single();
      if (quote.error) throw quote.error;
      if (!["DRAFT", "GENERATED"].includes(quote.data.status)) throw new Error("报价发送后附件作为业务凭证保留，不能删除");
    }
    if (attachment.sales_order_id) {
      const order = await admin.from("sales_orders")
        .select("status,prepared_by,sales_user_id")
        .eq("id", attachment.sales_order_id).single();
      if (order.error) throw order.error;
      if (order.data.status !== "DRAFT" || (order.data.prepared_by || order.data.sales_user_id) !== account.id)
        throw new Error("只有 PI 创建人可在草稿阶段删除理货附件");
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
