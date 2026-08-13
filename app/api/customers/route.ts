import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

const writableFields = ["company_name", "contact_name", "country", "phone", "whatsapp", "email", "website", "google_url", "address", "industry", "category", "source", "tags", "ai_score", "ai_level", "status", "owner_id"] as const;

function clean(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(writableFields.filter((key) => key in body).map((key) => [key, body[key] === "" ? null : body[key]]));
}

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireUser();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 10)));
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const status = request.nextUrl.searchParams.get("status");
    const deleted = request.nextUrl.searchParams.get("deleted") === "true";
    const aiLevel = request.nextUrl.searchParams.get("ai_level");
    const industry = request.nextUrl.searchParams.get("industry");
    const target = request.nextUrl.searchParams.get("target");
    let query = supabase.from("customers").select("*", { count: "exact" });
    query = deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
    if (search) query = query.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    if (status) query = query.eq("status", status);
    if (aiLevel) query = query.eq("ai_level", aiLevel);
    if (industry) query = query.ilike("industry", `%${industry}%`);
    if (target === "valid") query = query.gte("ai_score", 60);
    if (target === "invalid") query = query.lt("ai_score", 60);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
    if (error) throw error;
    return NextResponse.json({ data, count: count || 0, page, pageSize });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "查询失败" }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    if (!body.company_name) return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });
    const payload = { ...clean(body), created_by: user.id, owner_id: body.owner_id || user.id };
    const { data, error } = await supabase.from("customers").insert(payload).select().single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "CUSTOMER_CREATE", "customer", data.id, { company_name: data.company_name });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "新增失败" }, { status: 400 });
  }
}
