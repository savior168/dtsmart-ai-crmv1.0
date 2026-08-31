import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { permanentlyDeleteCustomers } from "@/lib/customers/soft-delete";

// Only user-entered source data is editable here. AI conclusions, verified
// contacts, ownership and workflow state must be changed by their dedicated
// server-side flows so an operator cannot overwrite traceable analysis data.
const writable = [
  "company_name", "contact_name", "country", "phone", "whatsapp", "email",
  "website", "google_url", "address", "category", "tags", "notes",
  "store_name", "product_image", "store_score", "review_count",
];

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user, account } = await requirePermission("customers.view");
    const { id } = await context.params;
    let query = supabase.from("customers").select("*").eq("id", id);
    if (!hasPermission(account, "customers.data_all")) query = query.or(`owner_id.eq.${user.id},created_by.eq.${user.id}`);
    const { data, error } = await query.single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "查询失败" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requirePermission("customers.edit");
    const { id } = await context.params;
    const body = await request.json();
    const payload = Object.fromEntries(writable.filter((key) => key in body).map((key) => [key, body[key] === "" ? null : body[key]]));
    const { data: customer, error: customerError } = await supabase.from("customers").select("id,owner_id,created_by,company_name,country").eq("id", id).single();
    if (customerError) throw customerError;
    const canEdit = customer.owner_id === user.id || (!customer.owner_id && customer.created_by === user.id);
    if (!canEdit) return NextResponse.json({ error: "只能编辑归属自己的客户原始资料；跨用户数据仅供查看" }, { status: 403 });
    if (!Object.keys(payload).length) return NextResponse.json({ error: "没有可保存的原始资料" }, { status: 400 });
    if (!(payload.company_name ?? customer.company_name)?.toString().trim()) return NextResponse.json({ error: "客户名称不能为空" }, { status: 400 });
    if (!(payload.country ?? customer.country)?.toString().trim()) return NextResponse.json({ error: "国家/地区不能为空" }, { status: 400 });
    const { data, error } = await supabase.from("customers").update(payload).eq("id", id).select().single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "CUSTOMER_UPDATE", "customer", id, { fields: Object.keys(payload) });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requirePermission("customers.delete");
    const { id } = await context.params;
    const result = await permanentlyDeleteCustomers({ supabase, userId: user.id, ids: [id] });
    if (!result.successIds.length) {
      return NextResponse.json({ error: result.failures[0]?.error || "删除未生效，请刷新后重试" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 });
  }
}
