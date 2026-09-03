import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requestedOwnerId, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { countrySearchTokens } from "@/lib/countries";
import { postgrestContains } from "@/lib/postgrest-search";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerIndexIdentityKeys, customerLookupIdentityKeys } from "@/lib/import-dedupe";

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

// The customer list must not download the full CRM/AI payload for every row.
// Long AI summaries and compatibility columns are only needed by the detail
// page; selecting the table fields explicitly keeps list responses small and
// makes sorting/pagination noticeably faster as the customer base grows.
const customerListFields = [
  "id",
  "company_name",
  "contact_name",
  "country",
  "phone",
  "email",
  "website",
  "google_url",
  "industry",
  "category",
  "source",
  "source_batch",
  "source_batch_id",
  "ai_score",
  "ai_level",
  "status",
  "owner_id",
  "last_contact_time",
  "created_at",
  "updated_at",
  "deleted_at",
  "website_email",
  "website_phone",
].join(",");

function postgrestInValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clean(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(writableFields.filter((key) => key in body).map((key) => [key, body[key] === "" ? null : body[key]]));
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("customers.view");
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const idsOnly = request.nextUrl.searchParams.get("ids_only") === "true";
    const pageSize = Math.min(idsOnly ? 1000 : 500, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const status = request.nextUrl.searchParams.get("status");
    const followupStatus = request.nextUrl.searchParams.get("followup_status");
    const target = request.nextUrl.searchParams.get("target");
    const aiLevel = request.nextUrl.searchParams.get("ai_level");
    const country = request.nextUrl.searchParams.get("country")?.trim();
    const scopeUserId = requestedOwnerId(request, account, "customers.data_all");
    const industries = request.nextUrl.searchParams.getAll("industry").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
    const sourceBatches = request.nextUrl.searchParams.getAll("source_batch").map((value) => value.trim()).filter(Boolean);
    const options = request.nextUrl.searchParams.get("options");
    const aiPending = request.nextUrl.searchParams.get("ai_pending") === "true";
    const aiDone = request.nextUrl.searchParams.get("ai_done") === "true";
    // The customer workbench defaults to scored records; callers can opt into
    // pending or all explicitly so an omitted parameter is never ambiguous.
    const aiStatus = request.nextUrl.searchParams.get("ai_status") || "done";
    const aiFailed = request.nextUrl.searchParams.get("ai_failed") === "true";
    const sort = request.nextUrl.searchParams.get("sort") || "created_at";
    const direction = request.nextUrl.searchParams.get("direction") === "asc" ? "asc" : "desc";

    if (options === "industries") {
      const values: string[] = [];
      for (let from = 0; ; from += 1000) {
        let pageQueryBuilder = supabase.from("customers")
          .select("industry")
          .is("deleted_at", null)
          .neq("status", "RELEASED")
          .not("industry", "is", null)
          .neq("industry", "")
          .order("industry", { ascending: true });
        if (scopeUserId && scopeUserId !== "unclaimed") pageQueryBuilder = pageQueryBuilder.eq("owner_id", scopeUserId);
        const pageQuery = await pageQueryBuilder.range(from, from + 999);
        if (pageQuery.error) throw pageQuery.error;
        values.push(...(pageQuery.data || []).map((item) => String(item.industry || "").trim()).filter(Boolean));
        if ((pageQuery.data || []).length < 1000) break;
      }
      const industries = Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, "zh-CN"));
      return NextResponse.json({ data: industries, count: industries.length });
    }
    if (options === "batches") {
      const grouped = new Map<string, { id: string; filename: string; created_at: string | null; customer_count: number; success_count: number | null; legacy: boolean }>();
      for (let from = 0; ; from += 1000) {
        let pageQueryBuilder = supabase.from("customers")
          .select("source_batch_id,source_batch,created_at")
          .is("deleted_at", null)
          .neq("status", "RELEASED")
          .not("source_batch", "is", null)
          .neq("source_batch", "")
          .order("created_at", { ascending: false });
        if (scopeUserId && scopeUserId !== "unclaimed") pageQueryBuilder = pageQueryBuilder.eq("owner_id", scopeUserId);
        const pageQuery = await pageQueryBuilder.range(from, from + 999);
        if (pageQuery.error) throw pageQuery.error;
        for (const row of pageQuery.data || []) {
          const filename = String(row.source_batch || "").trim();
          if (!filename) continue;
          const linkedId = String(row.source_batch_id || "").trim();
          const id = linkedId || `legacy:${filename}`;
          const current = grouped.get(id);
          grouped.set(id, {
            id,
            filename,
            created_at: current?.created_at || String(row.created_at || "") || null,
            customer_count: (current?.customer_count || 0) + 1,
            success_count: current?.success_count ?? null,
            legacy: !linkedId,
          });
        }
        if ((pageQuery.data || []).length < 1000) break;
      }
      const taskIds = [...grouped.values()].filter((item) => !item.legacy).map((item) => item.id);
      const admin = createAdminClient();
      for (let offset = 0; offset < taskIds.length; offset += 200) {
        let tasksQuery = admin.from("import_tasks")
          .select("id,filename,success_count,created_at")
          .in("id", taskIds.slice(offset, offset + 200));
        if (scopeUserId && scopeUserId !== "unclaimed") tasksQuery = tasksQuery.eq("created_by", scopeUserId);
        const tasks = await tasksQuery;
        if (tasks.error) throw tasks.error;
        for (const task of tasks.data || []) {
          const current = grouped.get(task.id);
          if (current) grouped.set(task.id, {
            ...current,
            filename: task.filename || current.filename,
            success_count: task.success_count ?? current.success_count,
            created_at: task.created_at || current.created_at,
          });
        }
      }
      const data = [...grouped.values()].sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
      return NextResponse.json({ data, count: data.length });
    }

    let query = supabase.from("customers").select(idsOnly ? "id,status" : customerListFields, { count: "exact" });
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
    // 客户列表以当前归属为准。客户的创建时间不能决定其是否仍属于
    // 销售员，否则历史客户被重新认领后会从“我的客户”中消失。
    query = query.neq("status", "RELEASED");
    // Website contact fields are optional extensions. Keep the list usable on
    // the original production schema while migration catches up.
    if (search) {
      const pattern = postgrestContains(search);
      const countryPatterns = countrySearchTokens(search)
        .map((item) => item.replace(/[(),]/g, " ").trim())
        .filter(Boolean)
        .map((item) => `country.ilike.${postgrestContains(item)}`);
      query = query.or([
        `company_name.ilike.${pattern}`,
        `contact_name.ilike.${pattern}`,
        `email.ilike.${pattern}`,
        `phone.ilike.${pattern}`,
        ...countryPatterns,
      ].join(","));
    }
    if (status) query = query.eq("status", status);
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
    if (hasPermission(account, "customers.data_all") && scopeUserId === "unclaimed") query = query.is("owner_id", null);
    else if (scopeUserId) query = query.eq("owner_id", scopeUserId);
    if (industries.length === 1) query = query.eq("industry", industries[0]);
    else if (industries.length > 1) query = query.in("industry", Array.from(new Set(industries)));
    if (sourceBatches.length) {
      const linkedIds = sourceBatches.filter((value) => !value.startsWith("legacy:"));
      const legacyNames = sourceBatches.filter((value) => value.startsWith("legacy:")).map((value) => value.slice(7));
      const conditions: string[] = [];
      if (linkedIds.length) conditions.push(`source_batch_id.in.(${linkedIds.map(postgrestInValue).join(",")})`);
      if (legacyNames.length) conditions.push(`source_batch.in.(${legacyNames.map(postgrestInValue).join(",")})`);
      if (conditions.length === 1 && linkedIds.length) query = query.in("source_batch_id", linkedIds);
      else if (conditions.length === 1) query = query.in("source_batch", legacyNames);
      else if (conditions.length) query = query.or(conditions.join(","));
    }
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

    // `followup_status` was added by a compatibility migration and is still
    // absent from some production databases. Do not request or sort by that
    // optional column in the base list query: legacy rows are rendered as
    // “待联系” by the client and the filter probe above safely handles
    // migrated databases without taking the whole customer list down.
    const allowedSort = new Set(["company_name", "contact_name", "phone", "email", "country", "industry", "source", "ai_score", "status", "owner_id", "created_at", "updated_at", "last_contact_time", "website", "google_url", "website_email", "website_phone"]);
    const sortField = allowedSort.has(sort) ? sort : "created_at";
    const from = (page - 1) * pageSize;
    const rangeEnd = from + pageSize - 1;
    const { data: allData, count, error } = await query.order(sortField, { ascending: direction === "asc", nullsFirst: false }).range(from, rangeEnd);
    if (error) throw error;
    // Supabase cannot infer a row type from the deliberately dynamic select
    // list above, so validate the transport shape before narrowing it here.
    const rawRows: unknown = allData || [];
    let responseData = Array.isArray(rawRows)
      ? rawRows.filter((item): item is Record<string, unknown> & { id: string } => Boolean(item && typeof item === "object" && "id" in item && typeof item.id === "string"))
      : [];
    if (!idsOnly && responseData.length) {
      const followupRows = await supabase.from("customers").select("id,followup_status").in("id", responseData.map((item) => item.id));
      if (!followupRows.error) {
        const byId = new Map((followupRows.data || []).map((item) => [item.id, item.followup_status || "WAITING_CONTACT"]));
        responseData = responseData.map((item) => ({ ...item, followup_status: byId.get(item.id) || "WAITING_CONTACT" }));
      }
    }
    return NextResponse.json({ data: responseData, count: count || responseData.length || 0, page, pageSize });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "查询失败" }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user, account } = await requirePermission("customers.create");
    const admin = createAdminClient();
    const body = await request.json();
    const publicPool = body.destination === "PUBLIC_POOL";
    if (publicPool && account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可以新增公海客户" }, { status: 403 });
    if (!body.company_name) return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });
    if (!body.country) return NextResponse.json({ error: "国家/地区不能为空" }, { status: 400 });
    if (![body.phone, body.email, body.website, body.google_url].some((value) => String(value || "").trim())) return NextResponse.json({ error: "完整号码、邮箱、官网或Google Maps网址至少填写一项" }, { status: 400 });
    const submittedKeys = customerLookupIdentityKeys(body);
    if (submittedKeys.length) {
      const possibleMatches: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        const page = await admin.from("customers")
          .select("id,company_name,phone,email,website,google_url,owner_id,created_at")
          .order("created_at", { ascending: true })
          .range(from, from + 999);
        if (page.error) throw page.error;
        possibleMatches.push(...(page.data || []));
        if ((page.data || []).length < 1000) break;
      }
      const existingByKey = new Map<string, Record<string, unknown>>();
      possibleMatches.forEach((item) => customerIndexIdentityKeys(item).forEach((key) => { if (!existingByKey.has(key)) existingByKey.set(key, item); }));
      const duplicate = submittedKeys.map((key) => existingByKey.get(key)).find(Boolean);
      const duplicateId = typeof duplicate?.id === "string" ? duplicate.id : null;
      if (duplicate && !duplicateId) throw new Error("重复客户记录缺少有效ID");
      if (duplicate?.owner_id === user.id) return NextResponse.json({ error: "该客户已存在于您的客户库中" }, { status: 409 });
      if (duplicate && publicPool) return NextResponse.json({ error: duplicate.owner_id ? "该客户已存在且已有归属人，不能重复加入公海" : "该客户已存在于客户公海" }, { status: 409 });
      if (duplicate) {
        const transfer = await supabase.rpc("take_over_expired_customer", { p_customer_id: duplicateId, p_source: "MANUAL_CREATE" });
        if (transfer.error) throw new Error(`客户归属校验失败：${transfer.error.message}`);
        const outcome = transfer.data && typeof transfer.data === "object" ? transfer.data as { transferred?: boolean; reason?: string } : {};
        if (outcome.transferred) {
          const transferred = await admin.from("customers").select("*").eq("id", duplicateId).single();
          if (transferred.error) throw transferred.error;
          return NextResponse.json(transferred.data, { status: 200 });
        }
        const conflict = {
          customer_id: duplicateId,
          reported_by: user.id,
          conflict_type: "CROSS_OWNER_DUPLICATE",
          status: "OPEN",
          details: { source: "MANUAL_CREATE", submitted: clean(body), matched_customer_id: duplicateId },
        };
        const prior = await admin.from("customer_conflicts").select("id").eq("reported_by", user.id).eq("customer_id", duplicateId).eq("status", "OPEN").limit(1).maybeSingle();
        const { error: conflictError } = prior.data
          ? { error: null }
          : await admin.from("customer_conflicts").insert(conflict);
        if (conflictError && conflictError.code !== "23505") {
          const { error: auditError } = await supabase.from("audit_logs").insert({ user_id: user.id, action: "CUSTOMER_CONFLICT_DETECTED", target_type: "customer", target_id: duplicateId, content: conflict });
          if (auditError) throw new Error(`冲突客户记录创建失败：${auditError.message}`);
        }
        const message = outcome.reason === "PUBLIC_POOL_AVAILABLE"
          ? "该客户已存在于系统公海，请前往客户公海提交凭证认领"
          : outcome.reason === "PERMANENT_PROTECTION"
            ? "已成交客户永久保护，已加入冲突客户列表"
            : "该客户已有归属或需管理员核对，已加入冲突客户列表";
        return NextResponse.json({ conflict: true, status: "CONFLICT", message }, { status: 201 });
      }
    }
    const payload: Record<string, unknown> = publicPool
      ? { ...clean(body), source: body.source || "ADMIN_MANUAL", status: "UNCLAIMED", followup_status: "WAITING_CONTACT", created_by: user.id, owner_id: null, owner_user_id: null, acquisition_scope: "PUBLIC_POOL", pool_status: "AVAILABLE", assigned_via: "ADMIN_ASSIGN" }
      : { ...clean(body), source: body.source || "MANUAL", status: "CLAIMED", followup_status: body.followup_status || "WAITING_CONTACT", created_by: user.id, owner_id: user.id, owner_user_id: user.id, acquisition_scope: "PRIVATE", pool_status: "CLAIMED", assigned_via: "PRIVATE_CREATE" };
    delete payload.destination;
    // 可选 AI 扩展字段由兼容迁移提供；旧版生产表不存在时，手动新增也必须正常完成。
    delete payload.ai_screening_done;
    delete payload.website_email;
    delete payload.website_phone;
    let { data, error } = await admin.from("customers").insert(payload).select().single();
    if (error && /followup_status.*(column|schema cache)|column.*followup_status/i.test(error.message)) {
      const legacyPayload = { ...payload };
      delete legacyPayload.followup_status;
      ({ data, error } = await admin.from("customers").insert(legacyPayload).select().single());
    }
    if (error) throw error;
    await writeAudit(supabase, user.id, "CUSTOMER_CREATE", "customer", data.id, { company_name: data.company_name, destination: publicPool ? "PUBLIC_POOL" : "PRIVATE" });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "新增失败" }, { status: 400 });
  }
}
