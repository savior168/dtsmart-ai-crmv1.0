import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { cleanQuotePayload, sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("quotes.view");
    const params = request.nextUrl.searchParams;
    const ownerId = await requestedOwnerId(request, account, "quotes.data_all");
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(500, Math.max(10, Number(params.get("page_size") || 20)));
    const from = (page - 1) * pageSize;
    let query = supabase.from("quotes")
      .select("id,customer_id,owner_id,quote_number,currency,status,valid_until,subtotal,shipping_cost,total_amount,customer_short_name,destination_country,customer_confirmed_at,created_at,updated_at,customer:customers(company_name),owner:users!quotes_owner_id_fkey(name,email)", { count: "exact" })
      .order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
    if (ownerId) query = query.eq("owner_id", ownerId);
    const status = params.get("status")?.trim();
    if (status) query = query.eq("status", status);
    const keyword = params.get("q")?.trim();
    if (keyword) query = query.or(`quote_number.ilike.%${keyword.replace(/[%_,()]/g, "")}%,customer_short_name.ilike.%${keyword.replace(/[%_,()]/g, "")}%`);
    const { data, error, count } = await query;
    if (error) throw error;
    return NextResponse.json({ data: data || [], count: count || 0, page, page_size: pageSize, profile: { id: account.id, role: account.role }, can_view_all: hasPermission(account, "quotes.data_all") });
  } catch (error) {
    const message = sqlErrorMessage(error, "报价列表加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("quotes.create");
    if (account.role === "ADMIN") return NextResponse.json({ error: "系统管理员负责系统维护，不创建销售报价" }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const payload = cleanQuotePayload(body);
    const status = ["DRAFT","GENERATED","SENT"].includes(String(body.status || "")) ? String(body.status) : "DRAFT";
    if (!payload.customer_id) throw new Error("请选择客户");
    const { data, error } = await supabase.rpc("create_quote_with_items", {
      p_customer_id: payload.customer_id,
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
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "报价单创建失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
