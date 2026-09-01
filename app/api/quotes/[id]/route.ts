import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { cleanQuotePayload, sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("quotes.view");
    const { id } = await context.params;
    const { data: quote, error } = await supabase.from("quotes")
      .select("*,customer:customers(id,company_name,contact_name,country,phone,email,address),owner:users!quotes_owner_id_fkey(id,name,email)")
      .eq("id", id).single();
    if (error) throw error;
    const [{ data: items, error: itemError }, { data: salesOrder }, { data: stockOrder }, { data: attachments, error: attachmentError }] = await Promise.all([
      supabase.from("quote_items").select("*").eq("quote_id", id).order("line_number"),
      supabase.from("sales_orders").select("id,order_number,status,updated_at").eq("quote_id", id).maybeSingle(),
      supabase.from("stock_orders").select("id,stock_number,status,updated_at").eq("quote_id", id).maybeSingle(),
      supabase.from("attachments").select("id,filename,mime_type,size_bytes,created_at,uploaded_by").eq("quote_id",id).order("created_at",{ascending:false}),
    ]);
    if (itemError) throw itemError;
    if (attachmentError) throw attachmentError;
    const writable = quote.owner_id === account.id || account.role === "ADMIN";
    return NextResponse.json({ quote, items: items || [], attachments: attachments || [], sales_order: salesOrder || null, stock_order: stockOrder || null, can_edit: writable && hasPermission(account, "quotes.edit") && ["DRAFT","GENERATED"].includes(quote.status), can_attach: writable && hasPermission(account,"quotes.edit") && ["DRAFT","GENERATED","SENT"].includes(quote.status), can_revise:writable&&hasPermission(account,"quotes.edit")&&["SENT","EXPIRED","CANCELLED"].includes(quote.status)&&!salesOrder, can_confirm: writable && hasPermission(account, "quotes.confirm") && ["GENERATED","SENT"].includes(quote.status), can_cancel: writable && hasPermission(account, "quotes.cancel") && !["CONFIRMED","CANCELLED","SUPERSEDED"].includes(quote.status), can_delete: writable && hasPermission(account,"quotes.cancel") && quote.status==="DRAFT" });
  } catch (error) {
    const message = sqlErrorMessage(error, "报价详情加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("quotes.cancel");
    const { id } = await context.params;
    const quote = await supabase.from("quotes").select("id,owner_id,status,quote_number").eq("id", id).single();
    if (quote.error) throw quote.error;
    if (quote.data.owner_id !== account.id && account.role !== "ADMIN") throw new Error("只能删除归属自己的报价草稿");
    if (quote.data.status !== "DRAFT") throw new Error("只有报价草稿可以删除，已生成的业务单据请使用取消");
    const admin=createAdminClient();
    const attachments=await admin.from("attachments").select("storage_path").eq("quote_id",id);
    if(attachments.error)throw attachments.error;
    const paths=(attachments.data||[]).map(item=>item.storage_path).filter((value):value is string=>Boolean(value));
    const deleted = await supabase.from("quotes").delete().eq("id", id);
    if (deleted.error) throw deleted.error;
    if(paths.length)await admin.storage.from("crm-attachments").remove(paths);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = sqlErrorMessage(error, "报价草稿删除失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("quotes.edit");
    const { id } = await context.params;
    const current = await supabase.from("quotes").select("status").eq("id",id).single();
    if(current.error)throw current.error;
    if(!["DRAFT","GENERATED"].includes(current.data.status))throw new Error("已发送报价不能直接覆盖，请创建新版本");
    const body = await request.json() as Record<string, unknown>;
    const payload = cleanQuotePayload(body);
    const status = String(body.status || "DRAFT");
    const { data, error } = await supabase.rpc("update_quote_customer_fields", {
      p_quote_id: id,
      p_status: status,
      p_currency: payload.currency,
      p_valid_until: payload.valid_until,
      p_payment_method: payload.payment_method,
      p_delivery_date: payload.delivery_date,
      p_customer_short_name: payload.customer_short_name,
      p_destination_country: payload.destination_country,
      p_shipping_cost: payload.shipping_cost,
      p_notes: payload.notes,
      p_items: payload.items,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "报价单保存失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
