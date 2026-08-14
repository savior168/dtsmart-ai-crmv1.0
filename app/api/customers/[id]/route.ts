import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

const writable = [
  "company_name",
  "contact_name",
  "country",
  "phone",
  "whatsapp",
  "email",
  "website",
  "google_url",
  "address",
  "industry",
  "category",
  "source",
  "tags",
  "rating",
  "ai_score",
  "ai_level",
  "ai_reason",
  "is_target_customer",
  "ai_screening_done",
  "website_email",
  "website_phone",
  "business_relevance",
  "customer_value",
  "followup_suggestion",
  "notes",
  "status",
];

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser();
    const { id } = await context.params;
    const { data, error } = await supabase.from("customers").select("*").eq("id", id).single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "查询失败" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const payload = Object.fromEntries(writable.filter((key) => key in body).map((key) => [key, body[key] === "" ? null : body[key]]));
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
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    const { data: accessibleCustomer, error: accessError } = await supabase
      .from("customers")
      .select("id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (accessError) throw accessError;
    if (!accessibleCustomer) return NextResponse.json({ error: "客户不存在、已删除或您没有删除权限" }, { status: 404 });
    const result = await supabase.from("customers").update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null);
    if (result.error) throw result.error;
    await writeAudit(supabase, user.id, "CUSTOMER_DELETE", "customer", id, {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 });
  }
}
