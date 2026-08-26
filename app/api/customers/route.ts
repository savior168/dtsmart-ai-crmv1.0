import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";
import { countrySearchTokens } from "@/lib/countries";
import { postgrestContains } from "@/lib/postgrest-search";
import { createAdminClient } from "@/lib/supabase/admin";

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
  "status", "followup_status",
  "owner_id",
] as const;

function clean(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(writableFields.filter((key) => key in body).map((key) => [key, body[key] === "" ? null : body[key]]));
}

const identityName = (value: unknown) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
const identityPhone = (value: unknown) => String(value || "").replace(/[\s()\-]/g, "");
const identityEmail = (value: unknown) => String(value || "").trim().toLowerCase();

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const idsOnly = request.nextUrl.searchParams.get("ids_only") === "true";
    const pageSize = Math.min(idsOnly ? 1000 : 500, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const status = request.nextUrl.searchParams.get("status");
    const followupStatus = request.nextUrl.searchParams.get("followup_status");
    const target = request.nextUrl.searchParams.get("target");
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

    let query = supabase.from("customers").select(idsOnly ? "id,status" : "*", { count: "exact" });
    // Older production databases may not have the additive followup_status
    // column yet. Probe once so filtering never turns into a generic reload
    // error; until migration is applied, legacy rows are treated as 待联系.
    let followupSupported = true;
    if (followupStatus) {
      const probe = await supabase.from("customers").select("followup_status").limit(1);
      followupSupported = !probe.error;
    }
    // Authorization is enforced by Supabase RLS. Do not narrow the result
    // again by creator/owner: doing so hides records that an administrator,
    // manager, or sales user is already permitted to see.
    query = query.is("deleted_at", null);
    // 客户列表只展示当前用户仍持有且尚未释放的客户；历史释放/到期客户
    // 由保护到期页统一展示，避免跨销售数据混入日常工作列表。
    const activeCutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    query = query.eq("owner_id", user.id).neq("status", "RELEASED").or(`status.in.(QUOTE,DEAL),created_at.gte.${activeCutoff}`);
    // Website contact fields are optional extensions. Keep the list usable on
    // the original production schema while migration catches up.
    if (search) {
      const pattern = postgrestContains(search);
      query = query.or(`company_name.ilike.${pattern},contact_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`);
    }
    if (status === "CLAIMED") query = query.in("status", ["CLAIMED", "FOLLOWING"]);
    else if (status) query = query.eq("status", status);
    // Treat legacy null/empty values as the default first-contact state so
    // older records remain discoverable by the new filter without overwriting
    // statuses that a salesperson has already updated manually.
    if (followupSupported && followupStatus === "WAITING_CONTACT") query = query.or("followup_status.eq.WAITING_CONTACT,followup_status.is.null");
    else if (followupSupported && followupStatus) query = query.eq("followup_status", followupStatus);
    else if (!followupSupported && followupStatus && followupStatus !== "WAITING_CONTACT") query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    if (aiLevel && ["A", "B", "C", "D"].includes(aiLevel.toUpperCase())) query = query.eq("ai_level", aiLevel.toUpperCase());
    if (country) {
      const filters = country.split(/[，,]/).flatMap((item) => countrySearchTokens(item)).map((item) => item.replace(/[(),]/g, " ").trim()).filter(Boolean);
      if (filters.length) query = query.or(Array.from(new Set(filters)).map((item) => `country.ilike.%${item}%`).join(","));
    }
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

    const allowedSort = new Set(["company_name", "contact_name", "phone", "email", "country", "industry", "source", "ai_score", "status", "followup_status", "owner_id", "created_at", "updated_at", "last_contact_time", "website", "google_url", "website_email", "website_phone"]);
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
    const admin = createAdminClient();
    const body = await request.json();
    if (!body.company_name) return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });
    if (!body.country) return NextResponse.json({ error: "国家/地区不能为空" }, { status: 400 });
    if (![body.phone, body.email, body.website, body.google_url].some((value) => String(value || "").trim())) return NextResponse.json({ error: "完整号码、邮箱、官网或Google Maps网址至少填写一项" }, { status: 400 });
    const submittedName = identityName(body.company_name);
    const submittedPhone = identityPhone(body.phone);
    const submittedEmail = identityEmail(body.email);
    if (submittedPhone || submittedEmail) {
      const { data: possibleMatches, error: matchError } = await admin
        .from("customers")
        .select("id,company_name,phone,email,owner_id")
        .ilike("company_name", String(body.company_name).trim())
        .limit(100);
      if (matchError) throw matchError;
      const duplicate = (possibleMatches || []).find((item) => {
        if (identityName(item.company_name) !== submittedName) return false;
        return Boolean((submittedPhone && identityPhone(item.phone) === submittedPhone) || (submittedEmail && identityEmail(item.email) === submittedEmail));
      });
      if (duplicate?.owner_id && duplicate.owner_id !== user.id) {
        const conflict = {
          customer_id: duplicate.id,
          reported_by: user.id,
          conflict_type: "CROSS_OWNER_DUPLICATE",
          status: "OPEN",
          details: { source: "MANUAL_CREATE", submitted: clean(body), matched_customer_id: duplicate.id },
        };
        const { error: conflictError } = await supabase.from("customer_conflicts").insert(conflict);
        if (conflictError) {
          const { error: auditError } = await supabase.from("audit_logs").insert({ user_id: user.id, action: "CUSTOMER_CONFLICT_DETECTED", target_type: "customer", target_id: duplicate.id, content: conflict });
          if (auditError) throw new Error(`冲突客户记录创建失败：${auditError.message}`);
        }
        return NextResponse.json({ conflict: true, status: "CONFLICT", message: "客户已归属其他销售员，已加入冲突客户列表" }, { status: 201 });
      }
      if (duplicate?.owner_id === user.id) return NextResponse.json({ error: "该客户已存在于您的客户库中" }, { status: 409 });
      if (duplicate && !duplicate.owner_id) {
        const { data: claimed, error: claimError } = await admin.from("customers").update({ owner_id: user.id, status: "CLAIMED" }).eq("id", duplicate.id).is("owner_id", null).select().single();
        if (claimError) throw claimError;
        await writeAudit(supabase, user.id, "CUSTOMER_AUTO_CLAIM", "customer", duplicate.id, { source: "MANUAL_CREATE" });
        return NextResponse.json(claimed, { status: 200 });
      }
    }
    const payload: Record<string, unknown> = { ...clean(body), status: "UNCLAIMED", followup_status: body.followup_status || "WAITING_CONTACT", created_by: user.id, owner_id: user.id };
    // 可选 AI 扩展字段由兼容迁移提供；旧版生产表不存在时，手动新增也必须正常完成。
    delete payload.ai_screening_done;
    delete payload.website_email;
    delete payload.website_phone;
    let { data, error } = await supabase.from("customers").insert(payload).select().single();
    if (error && /followup_status.*(column|schema cache)|column.*followup_status/i.test(error.message)) {
      const legacyPayload = { ...payload };
      delete legacyPayload.followup_status;
      ({ data, error } = await supabase.from("customers").insert(legacyPayload).select().single());
    }
    if (error) throw error;
    await writeAudit(supabase, user.id, "CUSTOMER_CREATE", "customer", data.id, { company_name: data.company_name });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "新增失败" }, { status: 400 });
  }
}
