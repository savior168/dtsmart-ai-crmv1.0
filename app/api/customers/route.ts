import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { countryFilterOptions, countryFilterRawValues, countrySearchTokens } from "@/lib/countries";
import { postgrestContains } from "@/lib/postgrest-search";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyExistingCustomer, customerIndexIdentityKeys, customerLookupIdentityKeys, potentialCustomerDuplicateReasons } from "@/lib/import-dedupe";
import { buildPrivateSupplementRows } from "@/lib/customers/private-supplements";
import { exportOfficialWebsiteText, legacyWebsiteExportPatch } from "@/lib/customers/export-public-channels";
import { assertOfficialWebsiteUrl, officialWebsiteUrl, publicChannelForUrl } from "@/lib/public-url";
import { normalizeManualPhone } from "@/lib/contacts/manual-phone";

// Manual creation must never impersonate AI conclusions, import provenance,
// ownership or workflow transitions. Those fields belong to dedicated flows.
const manualWritableFields = [
  "company_name", "contact_name", "country", "phone", "whatsapp", "email",
  "website", "google_url", "facebook_url", "instagram_url", "linkedin_url",
  "tiktok_url", "other_public_urls", "address", "category", "notes",
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
  "whatsapp",
  "email",
  "website",
  "google_url",
  "facebook_url",
  "instagram_url",
  "linkedin_url",
  "tiktok_url",
  "other_public_urls",
  "industry",
  "category",
  "source",
  "source_batch",
  "source_batch_id",
  "created_by",
  "ai_score",
  "ai_level",
  "ai_screening_done",
  "ai_status",
  "status",
  "owner_id",
  "last_contact_time",
  "created_at",
  "updated_at",
  "deleted_at",
  "website_email",
  "website_phone",
].join(",");
const customerExportFields = [customerListFields, "ai_reason", "business_scope", "business_relevance", "customer_value", "followup_suggestion", "company_scale"].join(",");

async function loadCustomerContacts(customerIds: string[]) {
  // An export page can contain 500 customers and more than PostgREST's
  // default 1,000 contact rows. Fetch every page instead of silently losing
  // phone/WhatsApp values beyond that limit.
  const batches = Array.from({ length: Math.ceil(customerIds.length / 100) }, (_, index) => customerIds.slice(index * 100, (index + 1) * 100));
  const admin = createAdminClient();
  const pages = await Promise.all(batches.map(async (ids) => {
    const contacts: Array<{ customer_id: string; type: string; value_raw: string; source_channel: string | null; exact_source_url: string | null; verification_status: string }> = [];
    for (let offset = 0;; offset += 1000) {
      const { data, error } = await admin.from("customer_contacts")
        .select("customer_id,type,value_raw,source_channel,exact_source_url,verification_status")
        .in("customer_id", ids)
        .in("verification_status", ["NEW_VERIFIED", "MATCHED_ORIGINAL", "SOURCE_CONFIRMED", "CONFLICTING_VERIFIED"])
        .order("captured_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      contacts.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    return contacts;
  }));
  return pages.flat();
}

function postgrestInValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clean(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(manualWritableFields.filter((key) => key in body).map((key) => [key, body[key] === "" ? null : body[key]]));
}

function validateManualUrl(value: unknown, label: string, host?: RegExp) {
  const text = String(value || "").trim();
  if (!text) return;
  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new Error(`${label}必须是完整的 http:// 或 https:// 链接`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`${label}只支持 http:// 或 https:// 链接`);
  if (host && !host.test(parsed.hostname.toLowerCase())) throw new Error(`${label}与所选平台域名不匹配`);
}

function validateManualContactInput(body: Record<string, unknown>) {
  body.phone = normalizeManualPhone(body.phone, "联系电话");
  body.whatsapp = normalizeManualPhone(body.whatsapp, "WhatsApp号码");
  const email = String(body.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("邮箱格式不正确");
  validateManualUrl(body.website, "官网网址");
  assertOfficialWebsiteUrl(body.website);
  validateManualUrl(body.google_url, "Google Maps网址", /(^|\.)google\.[a-z.]+$|(^|\.)googleusercontent\.com$|(^|\.)goo\.gl$/);
  validateManualUrl(body.facebook_url, "Facebook 链接", /(^|\.)facebook\.com$|(^|\.)fb\.com$/);
  validateManualUrl(body.instagram_url, "Instagram 链接", /(^|\.)instagram\.com$/);
  validateManualUrl(body.tiktok_url, "TikTok 链接", /(^|\.)tiktok\.com$/);
  validateManualUrl(body.linkedin_url, "LinkedIn 链接", /(^|\.)linkedin\.com$/);
  for (const url of Array.isArray(body.other_public_urls) ? body.other_public_urls : []) validateManualUrl(url, "社媒链接");
}

export async function GET(request: NextRequest) {
  try {
    const exportMode = request.nextUrl.searchParams.get("export") === "1";
    const { supabase, account } = await requirePermission(exportMode ? "customers.export" : "customers.view");
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const idsOnly = request.nextUrl.searchParams.get("ids_only") === "true";
    const pageSize = Math.min(idsOnly ? 1000 : 500, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const status = request.nextUrl.searchParams.get("status");
    const followupStatus = request.nextUrl.searchParams.get("followup_status");
    const target = request.nextUrl.searchParams.get("target");
    const aiLevel = request.nextUrl.searchParams.get("ai_level");
    const countries = [...new Set(request.nextUrl.searchParams.getAll("country").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
    const fromDate = request.nextUrl.searchParams.get("from")?.trim() || "";
    const toDate = request.nextUrl.searchParams.get("to")?.trim() || "";
    const reportUtc = request.nextUrl.searchParams.get("report_utc") === "1";
    const scopeUserId = await requestedOwnerId(request, account, "customers.data_all");
    const industries = request.nextUrl.searchParams.getAll("industry").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
    const sourceBatches = request.nextUrl.searchParams.getAll("source_batch").map((value) => value.trim()).filter(Boolean);
    const sourceType = request.nextUrl.searchParams.get("source_type")?.trim().toUpperCase() || "";
    const options = request.nextUrl.searchParams.get("options");
    const aiPending = request.nextUrl.searchParams.get("ai_pending") === "true";
    const aiDone = request.nextUrl.searchParams.get("ai_done") === "true";
    // The customer workbench defaults to scored records; callers can opt into
    // pending or all explicitly so an omitted parameter is never ambiguous.
    const aiStatus = request.nextUrl.searchParams.get("ai_status") || "done";
    const aiFailed = request.nextUrl.searchParams.get("ai_failed") === "true";
    const sort = request.nextUrl.searchParams.get("sort") || "updated_at";
    const direction = request.nextUrl.searchParams.get("direction") === "asc" ? "asc" : "desc";

    if (options === "industries" || options === "filters") {
      const values: Array<{industry:string;country:string}> = [];
      for (let from = 0; ; from += 1000) {
        let pageQueryBuilder = supabase.from("customers")
          .select("industry,country")
          .is("deleted_at", null)
          .not("owner_id", "is", null)
          .neq("status", "RELEASED")
          .order("industry", { ascending: true });
        if (scopeUserId) pageQueryBuilder = pageQueryBuilder.eq("owner_id", scopeUserId);
        const pageQuery = await pageQueryBuilder.range(from, from + 999);
        if (pageQuery.error) throw pageQuery.error;
        values.push(...(pageQuery.data || []).map((item) => ({industry:String(item.industry || "").trim(),country:String(item.country || "").trim()})));
        if ((pageQuery.data || []).length < 1000) break;
      }
      const counted=(items:string[])=>[...items.reduce((map,value)=>{if(value)map.set(value,(map.get(value)||0)+1);return map},new Map<string,number>())].map(([value,count])=>({value,label:value,count})).sort((left,right)=>right.count-left.count||left.label.localeCompare(right.label,"zh-CN"));
      const industryOptions=counted(values.map((item)=>item.industry));
      if(options === "industries")return NextResponse.json({ data: industryOptions.map((item)=>item.value), count: industryOptions.length });
      return NextResponse.json({countries:countryFilterOptions(values.map((item)=>item.country)),industries:industryOptions});
    }
    if (options === "batches") {
      const grouped = new Map<string, { id: string; filename: string; created_at: string | null; customer_count: number; success_count: number | null; legacy: boolean }>();
      for (let from = 0; ; from += 1000) {
        let pageQueryBuilder = supabase.from("customers")
          .select("source_batch_id,source_batch,created_at")
          .is("deleted_at", null)
          .not("owner_id", "is", null)
          .neq("status", "RELEASED")
          .not("source_batch", "is", null)
          .neq("source_batch", "")
          .order("created_at", { ascending: false });
        if (scopeUserId) pageQueryBuilder = pageQueryBuilder.eq("owner_id", scopeUserId);
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
        if (scopeUserId) tasksQuery = tasksQuery.eq("created_by", scopeUserId);
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

    let query = supabase.from("customers").select(idsOnly ? "id,status" : exportMode ? customerExportFields : customerListFields, { count: "exact" });
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
    // 旧 RELEASED 状态仅保留明确查询的兼容性；它不是无效目标判断。
    // 常规“我的客户”场景仍默认排除历史已释放记录。
    if (status !== "RELEASED") query = query.neq("status", "RELEASED");
    // “我的客户”无论按本人、指定归属人还是全部归属人查看，都只包含
    // 当前已经归属的客户。无归属客户只能在客户公海查看与处理。
    query = query.not("owner_id", "is", null);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      if (reportUtc) query = query.gte("created_at", `${fromDate}T00:00:00.000Z`);
      else query = query.gte("created_at", `${fromDate}T00:00:00.000+08:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      if (reportUtc) {
        const nextDay = new Date(`${toDate}T00:00:00.000Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        query = query.lt("created_at", nextDay.toISOString());
      } else query = query.lte("created_at", `${toDate}T23:59:59.999+08:00`);
    }
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
    if (aiLevel?.toUpperCase() === "UNSCREENED") query = query.or('ai_level.is.null,ai_level.eq.""');
    else if (aiLevel && ["A", "B", "C", "D"].includes(aiLevel.toUpperCase())) query = query.eq("ai_level", aiLevel.toUpperCase());
    if (countries.length) query = query.in("country", countryFilterRawValues(countries));
    if (scopeUserId) query = query.eq("owner_id", scopeUserId);
    if (industries.length === 1) query = query.eq("industry", industries[0]);
    else if (industries.length > 1) query = query.in("industry", Array.from(new Set(industries)));
    if (sourceType === "IMPORT") query = query.in("source", ["EXCEL_IMPORT", "BATCH_IMPORT", "CSV", "IMPORT"]);
    if (sourceType === "AI_ACQUISITION") query = query.in("source", ["AI_ACQUISITION", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN"]);
    if (sourceType === "MANUAL") query = query.in("source", ["MANUAL", "MANUAL_CREATE", "ADMIN_MANUAL"]);
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
    // `ai_status` distinguishes a genuine technical failure from a customer
    // that has not yet been submitted for analysis. Scores remain the business
    // result, never the execution-state indicator.
    if (aiStatus === "pending" || aiPending) query = query.eq("ai_status", "PENDING");
    else if (aiStatus === "done" || aiDone) query = query.eq("ai_status", "COMPLETED");
    else if (aiStatus === "failed" || aiFailed) query = query.eq("ai_status", "FAILED");
    // Score expresses priority, while this tri-state field records the gated
    // business conclusion. Null therefore remains outside both target lists.
    if (target === "valid") query = query.eq("ai_screening_done", true).eq("is_target_customer", true);
    if (target === "invalid") query = query.eq("ai_screening_done", true).eq("is_target_customer", false);
    if (target === "review") query = query.eq("ai_screening_done", true).is("is_target_customer", null);

    // `followup_status` was added by a compatibility migration and is still
    // absent from some production databases. Do not request or sort by that
    // optional column in the base list query: legacy rows are rendered as
    // “待联系” by the client and the filter probe above safely handles
    // migrated databases without taking the whole customer list down.
    const allowedSort = new Set(["company_name", "contact_name", "phone", "email", "country", "industry", "source", "source_batch", "ai_score", "status", "owner_id", "created_at", "updated_at", "last_contact_time", "website", "google_url", "website_email", "website_phone"]);
    const sortField = allowedSort.has(sort) ? sort : "updated_at";
    const from = (page - 1) * pageSize;
    const rangeEnd = from + pageSize - 1;
    const orderedQuery = query.order(sortField, { ascending: direction === "asc", nullsFirst: false });
    if (exportMode) orderedQuery.order("id", { ascending: true });
    const { data: allData, count, error } = await orderedQuery.range(from, rangeEnd);
    if (error) throw error;
    // Supabase cannot infer a row type from the deliberately dynamic select
    // list above, so validate the transport shape before narrowing it here.
    const rawRows: unknown = allData || [];
    let responseData = Array.isArray(rawRows)
      ? rawRows.filter((item): item is Record<string, unknown> & { id: string } => Boolean(item && typeof item === "object" && "id" in item && typeof item.id === "string"))
      : [];
    if (!idsOnly && responseData.length) {
      const userIds = [...new Set(responseData.flatMap((item) => [String(item.created_by || ""), String(item.owner_id || "")]).filter(Boolean))];
      const [followupRows, creators, verifiedContacts, scaleEvidence] = await Promise.all([
        supabase.from("customers").select("id,followup_status").in("id", responseData.map((item) => item.id)),
        userIds.length ? createAdminClient().from("users").select("id,name,email").in("id", userIds) : Promise.resolve({ data: [], error: null }),
        loadCustomerContacts(responseData.map((item) => item.id)),
        exportMode && account.role === "ADMIN"
          ? createAdminClient().from("customers").select("id,company_scale_evidence").in("id", responseData.map((item) => item.id))
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (scaleEvidence.error) throw scaleEvidence.error;
      const creatorById = new Map((creators.data || []).map((item) => [item.id, item]));
      const scaleEvidenceById = new Map((scaleEvidence.data || []).map((item) => [item.id, item.company_scale_evidence]));
      const contactsByCustomer = new Map<string, unknown[]>();
      for (const contact of verifiedContacts) {
        const current = contactsByCustomer.get(contact.customer_id) || [];
        current.push(contact);
        contactsByCustomer.set(contact.customer_id, current);
      }
      // Customer ownership is independent from the optional follow-up join.
      // If an older database does not expose followup_status, exports must not
      // silently lose the customer's real owner and creator.
      responseData = responseData.map((item) => {
        const rawWebsite = item.website || (contactsByCustomer.get(item.id) as Array<Record<string, unknown>> | undefined)?.find((contact) =>
          contact.type === "WEBSITE" && contact.verification_status === "NEW_VERIFIED"
        )?.value_raw || null;
        const historicalChannel = publicChannelForUrl(rawWebsite);
        const normalized = {
          ...item,
          website: exportMode ? exportOfficialWebsiteText(rawWebsite) : officialWebsiteUrl(rawWebsite),
          facebook_url: item.facebook_url || (historicalChannel === "facebook" ? rawWebsite : null),
          instagram_url: item.instagram_url || (historicalChannel === "instagram" ? rawWebsite : null),
          linkedin_url: item.linkedin_url || (historicalChannel === "linkedin" ? rawWebsite : null),
          tiktok_url: item.tiktok_url || (historicalChannel === "tiktok" ? rawWebsite : null),
        };
        return {
          ...normalized,
          company_scale_evidence: scaleEvidenceById.get(item.id) || null,
          ...(exportMode ? legacyWebsiteExportPatch(normalized, rawWebsite) : {}),
          creator: creatorById.get(String(item.created_by || "")) || null,
          owner: creatorById.get(String(item.owner_id || "")) || null,
          verified_contacts: contactsByCustomer.get(item.id) || [],
        };
      });
      if (!followupRows.error) {
        const byId = new Map((followupRows.data || []).map((item) => [item.id, item.followup_status || "WAITING_CONTACT"]));
        responseData = responseData.map((item) => ({ ...item, followup_status: byId.get(item.id) || "WAITING_CONTACT" }));
      }
    }
    if (account.role !== "ADMIN") {
      responseData = responseData.map((item) => ({ ...item, company_scale_evidence: null }));
    }
    return NextResponse.json({ data: responseData, count: count || responseData.length || 0, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user, account } = await requirePermission("customers.create");
    const admin = createAdminClient();
    const body = await request.json();
    validateManualContactInput(body);
    const publicPool = body.destination === "PUBLIC_POOL";
    const requestedStage = publicPool ? "UNCLAIMED" : String(body.status || "CLAIMED").toUpperCase();
    if (!publicPool && !["CLAIMED", "DEAL"].includes(requestedStage)) {
      return NextResponse.json({ error: requestedStage === "FOLLOWING"
        ? "意向客户必须先创建潜在客户，再提交真实佐证凭证完成阶段变更"
        : "无效客户阶段" }, { status: 400 });
    }
    if (requestedStage === "DEAL" && (!String(body.phone || "").trim() || !String(body.email || "").trim())) {
      return NextResponse.json({ error: "成交客户必须同时填写联系电话和邮箱" }, { status: 400 });
    }
    if (publicPool && account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可以新增公海客户" }, { status: 403 });
    if (!body.company_name) return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });
    if (!body.country) return NextResponse.json({ error: "国家/地区不能为空" }, { status: 400 });
    if (![body.phone, body.email, body.website, body.google_url].some((value) => String(value || "").trim())) return NextResponse.json({ error: "完整号码、邮箱、官网或Google Maps网址至少填写一项" }, { status: 400 });
    const submittedKeys = customerLookupIdentityKeys(body);
    if (submittedKeys.length) {
      const possibleMatches: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        const page = await admin.from("customers")
          .select("id,company_name,contact_name,country,phone,whatsapp,email,website,google_url,address,owner_id,acquisition_scope,pool_status,status,created_at")
          .is("deleted_at", null)
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
      const disposition = duplicate ? classifyExistingCustomer(duplicate, user.id) : null;
      if (disposition === "OWN_CUSTOMER") return NextResponse.json({ error: "该客户已存在于您的客户库中", status: "OWN_CUSTOMER", existing_customer_id: duplicateId, action_url: `/customers/${duplicateId}` }, { status: 409 });
      if (duplicate && publicPool) return NextResponse.json({ error: duplicate.owner_id ? "该客户已存在且已有归属人，不能重复加入公海" : "该客户已存在于客户公海" }, { status: 409 });
      if (duplicate && disposition === "PUBLIC_POOL_AVAILABLE") {
        const additions = buildPrivateSupplementRows(duplicate, body, { customerId: String(duplicateId), submittedBy: user.id, sourceType: "MANUAL_CREATE" });
        if (additions.length) {
          const saved = await admin.from("customer_private_supplements").upsert(additions, { onConflict: "customer_id,submitted_by,field_name,value_normalized", ignoreDuplicates: true });
          if (saved.error) throw new Error(`个人补充资料保存失败：${saved.error.message}`);
        }
        return NextResponse.json({ error: additions.length ? `系统客户公海已有该客户；已去重保存 ${additions.length} 项我的补充资料，请前往认领` : "系统客户公海已有该客户，填写资料与公海主档重复，请前往认领", status: "PUBLIC_POOL_AVAILABLE", supplement_count: additions.length, existing_customer_id: duplicateId, action_url: `/customers/pool?tab=available&customer=${encodeURIComponent(String(duplicateId))}` }, { status: 409 });
      }
      if (duplicate) {
        const transfer = await supabase.rpc("take_over_expired_customer", { p_customer_id: duplicateId, p_source: "MANUAL_CREATE" });
        if (transfer.error) throw new Error(`客户归属校验失败：${transfer.error.message}`);
        const outcome = transfer.data && typeof transfer.data === "object" ? transfer.data as { transferred?: boolean; reason?: string } : {};
        if (outcome.transferred) {
          const transferred = await admin.from("customers").select("*").eq("id", duplicateId).single();
          if (transferred.error) throw transferred.error;
          return NextResponse.json(transferred.data, { status: 200 });
        }
        if (outcome.reason === "PUBLIC_POOL_AVAILABLE") return NextResponse.json({ error: "系统客户公海已有该客户，请前往客户公海提交真实联系凭证认领", status: "PUBLIC_POOL_AVAILABLE", existing_customer_id: duplicateId, action_url: `/customers/pool?tab=available&customer=${encodeURIComponent(String(duplicateId))}` }, { status: 409 });
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
        return NextResponse.json({
          conflict: true,
          status: "CONFLICT",
          message,
          conflict_customer: {
            id: duplicateId,
            company_name: duplicate.company_name,
            country: duplicate.country,
            website: duplicate.website,
            google_url: duplicate.google_url,
            ownership_status: "已有归属或待管理员处理",
            match_reasons: submittedKeys.filter((key) => customerIndexIdentityKeys(duplicate).includes(key))
              .map((key) => key.startsWith("phone:") ? "电话或 whatsapp 一致" : key.startsWith("email:") ? "邮箱一致" : key.startsWith("website:") ? "官网一致" : "Google 地图主体一致"),
          },
          action_url: `/customers/conflicts?customer=${encodeURIComponent(String(duplicateId))}`,
        }, { status: 201 });
      }
      const potentialCustomers = possibleMatches
        .map((item) => ({ item, match_reasons: potentialCustomerDuplicateReasons(body, item) }))
        .filter((item) => item.match_reasons.length)
        .slice(0, 5);
      if (potentialCustomers.length && body.confirm_potential_duplicate !== true) {
        const ownerIds = [...new Set(potentialCustomers
          .filter(({ item }) => classifyExistingCustomer(item, user.id) === "OTHER_OWNED_CUSTOMER")
          .map(({ item }) => String(item.owner_id || "").trim())
          .filter(Boolean))];
        const ownerNames = new Map<string, string>();
        if (ownerIds.length) {
          const { data: owners, error: ownersError } = await admin.from("users").select("id,name").in("id", ownerIds);
          if (!ownersError) {
            for (const owner of owners || []) {
              const name = String(owner.name || "").trim();
              if (name) ownerNames.set(String(owner.id), name);
            }
          }
        }
        return NextResponse.json({
          error: "发现疑似重复客户，请核对后确认是否仍要新增。系统不会自动合并或覆盖已有客户资料。",
          status: "POTENTIAL_DUPLICATE",
          potential_customers: potentialCustomers.map(({ item, match_reasons }) => {
            const ownership = classifyExistingCustomer(item, user.id);
            return {
              id: item.id,
              company_name: item.company_name,
              country: item.country,
              website: item.website,
              google_url: item.google_url,
              match_reasons,
              ownership_disposition: ownership,
              ownership_status: ownership === "PUBLIC_POOL_AVAILABLE" ? "客户公海待认领" : ownership === "OWN_CUSTOMER" ? "我的客户" : ownership === "OTHER_OWNED_CUSTOMER" ? "已有归属人" : "待管理员核对",
              owner_name: ownership === "OTHER_OWNED_CUSTOMER" ? ownerNames.get(String(item.owner_id)) || null : null,
            };
          }),
        }, { status: 409 });
      }
    }
    const payload: Record<string, unknown> = publicPool
      ? { ...clean(body), source: "ADMIN_MANUAL", status: "UNCLAIMED", followup_status: "WAITING_CONTACT", created_by: user.id, owner_id: null, owner_user_id: null, acquisition_scope: "PUBLIC_POOL", pool_status: "AVAILABLE", assigned_via: "ADMIN_ASSIGN" }
      : { ...clean(body), source: "MANUAL", status: requestedStage, followup_status: "WAITING_CONTACT", created_by: user.id, owner_id: user.id, owner_user_id: user.id, acquisition_scope: "PRIVATE", pool_status: "CLAIMED", assigned_via: "PRIVATE_CREATE" };
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
    await writeAudit(supabase, user.id, "CUSTOMER_CREATE", "customer", data.id, { company_name: data.company_name, destination: publicPool ? "PUBLIC_POOL" : "PRIVATE", stage: requestedStage });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "新增失败" }, { status: 400 });
  }
}
