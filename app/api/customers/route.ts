import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

const writableFields = [
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
  "owner_id",
] as const;

function clean(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(writableFields.filter((key) => key in body).map((key) => [key, body[key] === "" ? null : body[key]]));
}

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireUser();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const idsOnly = request.nextUrl.searchParams.get("ids_only") === "true";
    const pageSize = Math.min(idsOnly ? 5000 : 100, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 10)));
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const status = request.nextUrl.searchParams.get("status");
    const target = request.nextUrl.searchParams.get("target");
    const deleted = request.nextUrl.searchParams.get("deleted") === "true";
    const aiLevel = request.nextUrl.searchParams.get("ai_level");
    const country = request.nextUrl.searchParams.get("country")?.trim();
    const ownerId = request.nextUrl.searchParams.get("owner_id")?.trim();
    const industry = request.nextUrl.searchParams.get("industry");
    const aiPending = request.nextUrl.searchParams.get("ai_pending") === "true";
    const aiDone = request.nextUrl.searchParams.get("ai_done") === "true";
    // The customer workbench defaults to scored records; callers can opt into
    // pending or all explicitly so an omitted parameter is never ambiguous.
    const aiStatus = request.nextUrl.searchParams.get("ai_status") || "done";
    const aiFailed = request.nextUrl.searchParams.get("ai_failed") === "true";
    const sort = request.nextUrl.searchParams.get("sort") || "created_at";
    const direction = request.nextUrl.searchParams.get("direction") === "asc" ? "asc" : "desc";

    let query = supabase.from("customers").select(idsOnly ? "id" : "*", { count: "exact" });
    // Authorization is enforced by Supabase RLS. Do not narrow the result
    // again by creator/owner: doing so hides records that an administrator,
    // manager, or sales user is already permitted to see.
    query = deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
    // Website contact fields are optional extensions. Keep the list usable on
    // the original production schema while migration catches up.
    if (search) query = query.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    if (status) query = query.eq("status", status);
    if (aiLevel) query = query.eq("ai_level", aiLevel);
    if (country) query = query.ilike("country", `%${country}%`);
    if (ownerId === "unclaimed") query = query.is("owner_id", null);
    else if (ownerId) query = query.eq("owner_id", ownerId);
    if (industry) query = query.ilike("industry", `%${industry}%`);
    // ai_score exists in every supported schema and is the stable completion flag.
    if (aiStatus === "pending" || aiPending) query = query.is("ai_score", null);
    else if (aiStatus === "done" || aiDone) query = query.not("ai_score", "is", null);
    if (aiFailed) query = query.ilike("ai_reason", "%失败%");
    // Keep target filtering compatible with both the migrated schema and the
    // original production schema. `ai_score` is always present and is the
    // canonical fallback when the optional boolean has not reached PostgREST's
    // schema cache yet.
    if (target === "valid") query = query.gte("ai_score", 60);
    if (target === "invalid") query = query.lt("ai_score", 60);

    const allowedSort = new Set(["company_name", "phone", "email", "country", "industry", "source", "ai_score", "status", "owner_id", "created_at", "last_contact_time"]);
    const sortField = allowedSort.has(sort) ? sort : "created_at";
    const from = (page - 1) * pageSize;
    const rangeEnd = from + pageSize - 1;
    const { data: allData, count, error } = await query.order(sortField, { ascending: direction === "asc", nullsFirst: false }).range(from, rangeEnd);
    if (error) throw error;
    return NextResponse.json({ data: allData || [], count: count || allData?.length || 0, page, pageSize });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "查询失败" }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    if (!body.company_name) return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });
    if (!body.country) return NextResponse.json({ error: "国家/地区不能为空" }, { status: 400 });
    if (![body.phone, body.email, body.website, body.google_url].some((value) => String(value || "").trim())) return NextResponse.json({ error: "完整号码、邮箱、官网或Google Maps网址至少填写一项" }, { status: 400 });
    const payload: Record<string, unknown> = { ...clean(body), status: "UNCLAIMED", created_by: user.id, owner_id: user.id };
    // 可选 AI 扩展字段由兼容迁移提供；旧版生产表不存在时，手动新增也必须正常完成。
    delete payload.ai_screening_done;
    delete payload.website_email;
    delete payload.website_phone;
    const { data, error } = await supabase.from("customers").insert(payload).select().single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "CUSTOMER_CREATE", "customer", data.id, { company_name: data.company_name });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "新增失败" }, { status: 400 });
  }
}
