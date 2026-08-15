import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";
import { softDeleteCustomers } from "@/lib/customers/soft-delete";

const writable = [
  "company_name", "contact_name", "country", "phone", "whatsapp", "email",
  "website", "google_url", "address", "industry", "category", "source", "tags",
  "rating", "ai_score", "ai_level", "ai_reason", "is_target_customer",
  "ai_screening_done", "website_email", "website_phone", "business_relevance",
  "customer_value", "followup_suggestion", "notes", "status",
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
    delete payload.ai_screening_done;
    delete payload.website_email;
    delete payload.website_phone;
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
    const result = await softDeleteCustomers({ supabase, userId: user.id, ids: [id] });
    if (!result.successIds.length) {
      return NextResponse.json({ error: result.failures[0]?.error || "删除未生效，请刷新后重试" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 });
  }
}
