import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { cleanQuotePayload, sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("quotes.view");
    const { id } = await context.params;
    const { data: quote, error } = await supabase.from("quotes")
      .select("*,customer:customers(id,company_name,contact_name,country,phone,email,address),owner:users!quotes_owner_id_fkey(id,name,email)")
      .eq("id", id).single();
    if (error) throw error;
    const [{ data: items, error: itemError }, { data: stockOrder }, { data: attachments, error: attachmentError }] = await Promise.all([
      supabase.from("quote_items").select("*").eq("quote_id", id).order("line_number"),
      supabase.from("stock_orders").select("id,stock_number,status,updated_at").eq("quote_id", id).maybeSingle(),
      supabase.from("attachments").select("id,filename,mime_type,size_bytes,created_at,uploaded_by").eq("quote_id",id).order("created_at",{ascending:false}),
    ]);
    if (itemError) throw itemError;
    if (attachmentError) throw attachmentError;
    const writable = quote.owner_id === account.id || account.role === "ADMIN";
    return NextResponse.json({ quote, items: items || [], attachments: attachments || [], stock_order: stockOrder || null, can_edit: writable && hasPermission(account, "quotes.edit") && ["DRAFT","GENERATED","SENT"].includes(quote.status), can_confirm: writable && hasPermission(account, "quotes.confirm") && ["GENERATED","SENT"].includes(quote.status), can_cancel: writable && hasPermission(account, "quotes.cancel") && !["CONFIRMED","CANCELLED"].includes(quote.status) });
  } catch (error) {
    const message = sqlErrorMessage(error, "报价详情加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("quotes.edit");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const payload = cleanQuotePayload(body);
    const status = String(body.status || "DRAFT");
    const { data, error } = await supabase.rpc("update_quote_with_items", {
      p_quote_id: id,
      p_status: status,
      p_currency: payload.currency,
      p_valid_until: payload.valid_until,
      p_payment_method: payload.payment_method,
      p_delivery_date: payload.delivery_date,
      p_customer_short_name: payload.customer_short_name,
      p_destination_country: payload.destination_country,
      p_stocking_requirements: payload.stocking_requirements,
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
