import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { postgrestContains } from "@/lib/postgrest-search";
import { customerIndustryLabels, rawCategoryPatternsForIndustryLabel } from "@/lib/customers/industry-display";

type PoolDbRow = Record<string, unknown> & {
  id: string;
  owner_id: string | null;
  contact_name?: unknown;
  phone?: unknown;
  whatsapp?: unknown;
  email?: unknown;
  website_phone?: unknown;
  website_email?: unknown;
  address?: unknown;
  website?: unknown;
  google_url?: unknown;
  facebook_url?: unknown;
  instagram_url?: unknown;
  linkedin_url?: unknown;
  tiktok_url?: unknown;
  other_public_urls?: unknown;
};

const RESTRICTED_POOL_EMAILS = new Set(["laura@dt-smart.com", "xavia@dt-smart.com"]);
const RESTRICTED_POOL_BATCHES = ["255 WT谷歌数据 波兰 (2).xlsx", "500 WT谷歌数据 波兰 (1).xlsx"] as const;
const poolOptionsCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();

function maskPhone(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length <= 5 ? "****" : `${text.slice(0, 3)} **** ${text.slice(-2)}`;
}

function maskEmail(value: unknown) {
  const text = String(value || "").trim();
  const [local, domain] = text.split("@");
  if (!local || !domain) return text ? "****" : null;
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskAddress(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length <= 8 ? "****" : `${text.slice(0, 8)}…`;
}

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("customers.view");
    const admin = createAdminClient();
    const params = request.nextUrl.searchParams;
    const tab = params.get("tab") || "available";
    const restrictedBatchView = tab === "available" && RESTRICTED_POOL_EMAILS.has(account.email.trim().toLowerCase());
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("page_size") || 20)));
    const search = params.get("q")?.trim() || "";
    const createdFrom = params.get("created_from")?.trim() || "";
    const createdTo = params.get("created_to")?.trim() || "";
    const countries = [...new Set(params.getAll("country").map((value) => value.trim()).filter(Boolean))];
    const industries = params.getAll("industry").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
    const industryGroups = [...new Set(params.getAll("industry_group").map((value) => value.trim()).filter(Boolean))];
    const aiLevel = params.get("ai_level")?.trim().toUpperCase() || "";
    const aiStatus = params.get("ai_status")?.trim().toLowerCase() || "all";
    const target = params.get("target")?.trim() || "";
    const customerStatus = params.get("status")?.trim().toUpperCase() || "";
    const ownerId = params.get("owner_id")?.trim() || "";
    const sourceType = params.get("source_type")?.trim().toUpperCase() || "";
    const sourceBatches = [...new Set(params.getAll("source_batch").map((value) => value.trim()).filter(Boolean))];
    const aiTaskIds = [...new Set(params.getAll("ai_task_id").flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))];
    const customerId = params.get("customer_id")?.trim() || "";
    const sort = params.get("sort") || "updated_at";
    const direction = params.get("direction") === "asc" ? "asc" : "desc";
    // Claimed customers have left the public pool. They are visible only to
    // their owner, that owner's direct supervisor, or the system administrator.
    const directReports = account.role === "SUPERVISOR"
      ? await admin.from("users").select("id").eq("manager_id", account.id).eq("status", "ACTIVE")
      : { data: [], error: null };
    if (directReports.error) throw directReports.error;
    const claimScopeOwnerIds = account.role === "ADMIN"
      ? null
      : account.role === "SUPERVISOR"
        ? [account.id, ...(directReports.data || []).map((item) => item.id)]
        : [account.id];
    if (params.get("counts") === "1") {
      const baseCount = () => admin.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null);
      const availableQuery = baseCount().eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "AVAILABLE").eq("status", "UNCLAIMED").is("owner_id", null);
      if (restrictedBatchView) availableQuery.in("source_batch", [...RESTRICTED_POOL_BATCHES]);
      let claimedQuery = baseCount().eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "CLAIMED").neq("status", "UNCLAIMED").not("owner_id", "is", null);
      if (claimScopeOwnerIds) claimedQuery = claimedQuery.in("owner_id", claimScopeOwnerIds);
      const pendingQuery = baseCount().eq("acquisition_scope", "PRIVATE").eq("pool_status", "PENDING_ALLOCATION").eq("status", "UNCLAIMED").is("owner_id", null);
      const renewalQuery = admin.from("customer_protection_renewal_requests").select("id,owner:users!customer_protection_renewal_requests_owner_id_fkey(manager_id)").eq("status", "PENDING");
      const historyQuery = account.role === "ADMIN"
        ? admin.from("customer_assignment_batches").select("id", { count: "exact", head: true })
        : Promise.resolve({ count: 0, error: null });
      const [available, claimed, pending, renewals, history] = await Promise.all([availableQuery, claimedQuery, pendingQuery, renewalQuery, historyQuery]);
      const failure = [available.error, claimed.error, pending.error, renewals.error, history.error].find(Boolean);
      if (failure) throw failure;
      const renewalRows = account.role === "SUPERVISOR"
        ? (renewals.data || []).filter((item) => {
            const owner = Array.isArray(item.owner) ? item.owner[0] : item.owner;
            return owner?.manager_id === account.id;
          })
        : renewals.data || [];
      return NextResponse.json({
        available: available.count || 0,
        claimed: claimed.count || 0,
        pending: account.role === "ADMIN" ? pending.count || 0 : 0,
        history: account.role === "ADMIN" ? history.count || 0 : 0,
        renewals: ["ADMIN", "SUPERVISOR"].includes(account.role) ? renewalRows.length : 0,
      }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
    }
    const allowed = new Set(["available", "claimed", "pending"]);
    if (!allowed.has(tab)) return NextResponse.json({ error: "无效的公海分类" }, { status: 400 });
    if (tab === "pending" && account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可以查看待分配客户" }, { status: 403 });
    const elevated = account.role === "ADMIN" || account.role === "SUPERVISOR";
    const exportMode = params.get("export") === "1";
    if (exportMode && account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可以导出客户公海数据" }, { status: 403 });
    if (ownerId && (!elevated || (claimScopeOwnerIds && !claimScopeOwnerIds.includes(ownerId)))) return NextResponse.json({ error: "当前角色不能按该认领人筛选" }, { status: 403 });

    if (params.get("options") === "1") {
      const optionCacheKey = [account.id, account.role, tab, restrictedBatchView ? "restricted" : "all", countries.join(","), aiLevel, aiStatus, target, sourceType, sourceBatches.join(","), ...(claimScopeOwnerIds || [])].join("|");
      const cachedOptions = poolOptionsCache.get(optionCacheKey);
      if (cachedOptions && cachedOptions.expiresAt > Date.now()) {
        return NextResponse.json(cachedOptions.payload, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=90" } });
      }
      const optionRows: Array<{ id: string; country:string | null; industry: string | null; category: string | null; ai_screening_done: boolean | null; owner_id: string | null; source: string | null; source_batch: string | null }> = [];
      for (let offset = 0; offset < 20000; offset += 1000) {
        let optionQuery = admin.from("customers").select("id,country,industry,category,ai_screening_done,owner_id,source,source_batch").is("deleted_at", null);
        if (tab === "available") optionQuery = optionQuery.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "AVAILABLE").eq("status", "UNCLAIMED").is("owner_id", null);
        if (restrictedBatchView) optionQuery = optionQuery.in("source_batch", [...RESTRICTED_POOL_BATCHES]);
        if (tab === "claimed") {
          optionQuery = optionQuery.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "CLAIMED").neq("status", "UNCLAIMED").not("owner_id", "is", null);
          if (claimScopeOwnerIds) optionQuery = optionQuery.in("owner_id", claimScopeOwnerIds);
        }
        if (tab === "pending") optionQuery = optionQuery.eq("acquisition_scope", "PRIVATE").eq("pool_status", "PENDING_ALLOCATION").eq("status", "UNCLAIMED").is("owner_id", null);
        if (countries.length) optionQuery = optionQuery.in("country", countries);
        if (["A", "B", "C", "D"].includes(aiLevel)) optionQuery = optionQuery.eq("ai_level", aiLevel);
        if (aiStatus === "pending") optionQuery = optionQuery.eq("ai_status", "PENDING");
        else if (aiStatus === "done") optionQuery = optionQuery.eq("ai_status", "COMPLETED");
        else if (aiStatus === "failed") optionQuery = optionQuery.eq("ai_status", "FAILED");
        if (target === "valid") optionQuery = optionQuery.eq("ai_screening_done", true).eq("is_target_customer", true);
        if (target === "invalid") optionQuery = optionQuery.eq("ai_screening_done", true).eq("is_target_customer", false);
        if (target === "review") optionQuery = optionQuery.eq("ai_screening_done", true).is("is_target_customer", null);
        if (sourceType === "IMPORT") optionQuery = optionQuery.in("source", ["EXCEL_IMPORT", "BATCH_IMPORT", "CSV", "IMPORT"]);
        if (sourceType === "AI_ACQUISITION") optionQuery = optionQuery.in("source", ["AI_ACQUISITION", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN"]);
        if (sourceType === "MANUAL") optionQuery = optionQuery.in("source", ["MANUAL", "MANUAL_CREATE", "ADMIN_MANUAL"]);
        if (!restrictedBatchView && sourceBatches.length === 1) optionQuery = optionQuery.eq("source_batch", sourceBatches[0]);
        else if (!restrictedBatchView && sourceBatches.length > 1) optionQuery = optionQuery.in("source_batch", sourceBatches);
        const optionPage = await optionQuery.order("updated_at", { ascending: false }).range(offset, offset + 999);
        if (optionPage.error) throw optionPage.error;
        const pageRows = optionPage.data || [];
        optionRows.push(...pageRows);
        if (pageRows.length < 1000) break;
      }
      const ownerIds = [...new Set(optionRows.map((item) => item.owner_id).filter(Boolean))] as string[];
      const owners = elevated && ownerIds.length
        ? await admin.from("users").select("id,name,email").in("id", ownerIds).order("name")
        : { data: [], error: null };
      if (owners.error) throw owners.error;
      const verifiedIndustryMap = new Map<string, { value: string; label: string; values: string[] }>();
      const rawIndustryMap = new Map<string, Set<string>>();
      const industryCustomerIds = new Map<string, Set<string>>();
      for (const item of optionRows) {
        const display = customerIndustryLabels(item);
        if (display.verified && item.industry?.trim()) {
          const value = item.industry.trim();
          verifiedIndustryMap.set(value, { value: `ai:${value}`, label: value, values: [`ai:${value}`] });
          const ids = industryCustomerIds.get(value) || new Set<string>();
          ids.add(item.id);
          industryCustomerIds.set(value, ids);
        }
        else if (item.category?.trim()) {
          const rawCategory = item.category.trim();
          for (const label of display.labels) {
            const categories = rawIndustryMap.get(label) || new Set<string>();
            categories.add(rawCategory);
            rawIndustryMap.set(label, categories);
            const ids = industryCustomerIds.get(label) || new Set<string>();
            ids.add(item.id);
            industryCustomerIds.set(label, ids);
          }
        }
      }
      const industryOptionMap = new Map<string, { value: string; label: string; values: string[]; tone: "verified" | "raw" | "mixed"; count: number }>();
      for (const item of verifiedIndustryMap.values()) industryOptionMap.set(item.label, { ...item, value: `industry:${item.label}`, tone: "verified", count: industryCustomerIds.get(item.label)?.size || 0 });
      for (const [label, categories] of rawIndustryMap.entries()) {
        const rawValues = categories.size ? [`group:${label}`] : [];
        const current = industryOptionMap.get(label);
        industryOptionMap.set(label, current
          ? { ...current, values: [...current.values, ...rawValues], tone: "mixed", count: industryCustomerIds.get(label)?.size || 0 }
          : { value: `industry:${label}`, label, values: rawValues, tone: "raw", count: industryCustomerIds.get(label)?.size || 0 });
      }
      const industries = [...industryOptionMap.values()];
      const countryCount=new Map<string,number>();
      for(const item of optionRows){const value=String(item.country||"").trim();if(value)countryCount.set(value,(countryCount.get(value)||0)+1)}
      const countryOptions=[...countryCount].map(([value,count])=>({value,label:value,count})).sort((left,right)=>right.count-left.count||left.label.localeCompare(right.label,"zh-CN"));
      const sourceGroup = (value?: string | null) => {
        const normalized = String(value || "").toUpperCase();
        if (["EXCEL_IMPORT", "BATCH_IMPORT", "CSV", "IMPORT"].includes(normalized)) return "IMPORT";
        if (["AI_ACQUISITION", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN"].includes(normalized)) return "AI_ACQUISITION";
        if (["MANUAL", "MANUAL_CREATE", "ADMIN_MANUAL"].includes(normalized)) return "MANUAL";
        return "";
      };
      const batches = [...new Map(optionRows
        .filter((item) => String(item.source_batch || "").trim())
        .map((item) => {
          const value = String(item.source_batch || "").trim();
          return [value, { value, label: value, source: sourceGroup(item.source) }];
        })).values()].sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
      // Administrators must be able to load any real historical screening
      // batch, including a batch whose customers have since moved between
      // public-pool tabs.  Restricting this menu to the current tab hid valid
      // history and made the batch filter appear unavailable.
      const screeningTasks = account.role === "ADMIN"
        ? await admin.from("ai_screening_tasks").select("id,task_number,name,total_count,created_at").gt("total_count", 0).order("created_at", { ascending: false }).limit(500)
        : { data: [], error: null };
      if (screeningTasks.error) throw screeningTasks.error;
      const payload = {
        countries: countryOptions,
        industries: industries.sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
        owners: owners.data || [],
        sources: [
          { value: "IMPORT", label: "批量导入" },
          { value: "AI_ACQUISITION", label: "AI获客" },
          { value: "MANUAL", label: "手动新增" },
        ].filter((option) => optionRows.some((item) => sourceGroup(item.source) === option.value)),
        batches,
        screening_tasks: (screeningTasks.data || []).map((task) => ({ value: task.id, label: `${task.task_number || "未编号"} · ${task.name || "未命名任务"}`, customer_count: Number(task.total_count || 0) })),
      };
      poolOptionsCache.set(optionCacheKey, { expiresAt: Date.now() + 60_000, payload });
      return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=90" } });
    }

    // Website contact and follow-up status are compatibility columns. Probe
    // them together so older production schemas keep the public-pool usable.
    const optionalProbe = await admin.from("customers").select("website_email,website_phone,followup_status").limit(1);
    const hasOptionalFields = !optionalProbe.error;
    const optionalSelect = hasOptionalFields ? ",website_email,website_phone,followup_status" : "";
    let query = admin.from("customers").select(
      exportMode ? "*" : `id,company_name,contact_name,country,address,industry,category,phone,whatsapp,email,website,google_url,facebook_url,instagram_url,linkedin_url,tiktok_url,other_public_urls,ai_level,ai_score,ai_screening_done,ai_status,is_target_customer,business_scope,source,source_batch,source_batch_id,created_by,owner_id,pool_status,acquisition_scope,assigned_via,claimed_at,status,last_contact_time,created_at,updated_at${optionalSelect}`,
      { count: "exact" },
    ).is("deleted_at", null);
    if (tab === "available") query = query.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "AVAILABLE").eq("status", "UNCLAIMED").is("owner_id", null);
    if (restrictedBatchView) query = query.in("source_batch", [...RESTRICTED_POOL_BATCHES]);
    if (tab === "claimed") {
      query = query.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "CLAIMED").neq("status", "UNCLAIMED").not("owner_id", "is", null);
      if (claimScopeOwnerIds) query = query.in("owner_id", claimScopeOwnerIds);
    }
    if (tab === "pending") query = query.eq("acquisition_scope", "PRIVATE").eq("pool_status", "PENDING_ALLOCATION").eq("status", "UNCLAIMED").is("owner_id", null);
    if (search) {
      const pattern = postgrestContains(search.replace(/[(),]/g, " "));
      // Search practical identifiers without turning masked claimed contacts
      // into an oracle for customers owned by another salesperson.
      const searchable = ["company_name", "country", "industry"];
      if (tab !== "claimed" || account.role === "ADMIN") {
        searchable.push("contact_name", "phone", "whatsapp", "email", "website", "google_url");
        if (hasOptionalFields) searchable.push("website_phone", "website_email");
      }
      query = query.or(searchable.map((field) => `${field}.ilike.${pattern}`).join(","));
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(createdFrom)) query = query.gte("created_at", `${createdFrom}T00:00:00.000+08:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(createdTo)) query = query.lte("created_at", `${createdTo}T23:59:59.999+08:00`);
    if (countries.length) query = query.in("country", countries);
    const verifiedIndustries = industries.filter((value) => value.startsWith("ai:")).map((value) => value.slice(3));
    const rawCategories = industries.filter((value) => value.startsWith("raw:")).map((value) => value.slice(4));
    const quoted = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    if (industryGroups.length) {
      const anyIndustry = [
        ...industryGroups.map((value) => `and(ai_screening_done.is.true,industry.eq.${quoted(value)})`),
        ...industryGroups.flatMap((label) => rawCategoryPatternsForIndustryLabel(label).flatMap((pattern) => [
          `and(ai_screening_done.is.false,category.ilike.${quoted(pattern)})`,
          `and(ai_screening_done.is.null,category.ilike.${quoted(pattern)})`,
        ])),
      ];
      if (anyIndustry.length) query = query.or(anyIndustry.join(","));
    } else if (verifiedIndustries.length && !rawCategories.length) query = query.eq("ai_screening_done", true).in("industry", verifiedIndustries);
    else if (!verifiedIndustries.length && rawCategories.length) query = query.or("ai_screening_done.is.false,ai_screening_done.is.null").in("category", rawCategories);
    else if (verifiedIndustries.length || rawCategories.length) {
      const anyIndustry = [
        ...verifiedIndustries.map((value) => `and(ai_screening_done.is.true,industry.eq.${quoted(value)})`),
        ...rawCategories.flatMap((value) => [
          `and(ai_screening_done.is.false,category.eq.${quoted(value)})`,
          `and(ai_screening_done.is.null,category.eq.${quoted(value)})`,
        ]),
      ];
      query = query.or(anyIndustry.join(","));
    }
    if (["A", "B", "C", "D"].includes(aiLevel)) query = query.eq("ai_level", aiLevel);
    if (aiStatus === "pending") query = query.eq("ai_status", "PENDING");
    else if (aiStatus === "done") query = query.eq("ai_status", "COMPLETED");
    else if (aiStatus === "failed") query = query.eq("ai_status", "FAILED");
    // Only completed AI analyses belong to the two business-result filters.
    // Unscreened customers stay under the ordinary "all" condition rather
    // than being presented as a third target-result value.
    if (target === "valid") query = query.eq("ai_screening_done", true).eq("is_target_customer", true);
    if (target === "invalid") query = query.eq("ai_screening_done", true).eq("is_target_customer", false);
    if (target === "review") query = query.eq("ai_screening_done", true).is("is_target_customer", null);
    if (tab === "claimed" && ["CLAIMED", "FOLLOWING", "QUOTE", "DEAL", "RELEASED"].includes(customerStatus)) query = query.eq("status", customerStatus);
    if (ownerId && tab === "claimed") query = query.eq("owner_id", ownerId);
    if (sourceType === "IMPORT") query = query.in("source", ["EXCEL_IMPORT", "BATCH_IMPORT", "CSV", "IMPORT"]);
    if (sourceType === "AI_ACQUISITION") query = query.in("source", ["AI_ACQUISITION", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN"]);
    if (sourceType === "MANUAL") query = query.in("source", ["MANUAL", "MANUAL_CREATE", "ADMIN_MANUAL"]);
    if (restrictedBatchView) query = query.in("source_batch", [...RESTRICTED_POOL_BATCHES]);
    else if (sourceBatches.length === 1) query = query.eq("source_batch", sourceBatches[0]);
    else if (sourceBatches.length > 1) query = query.in("source_batch", sourceBatches);
    if (aiTaskIds.length) {
      if (account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可按AI筛选批次查询" }, { status: 403 });
      const matchedCustomerIds = new Set<string>();
      for (let offset = 0; ; offset += 1000) {
        const taskItems = await admin.from("ai_screening_task_items").select("customer_id").in("task_id", aiTaskIds).range(offset, offset + 999);
        if (taskItems.error) throw taskItems.error;
        for (const item of taskItems.data || []) if (item.customer_id) matchedCustomerIds.add(String(item.customer_id));
        if ((taskItems.data || []).length < 1000) break;
      }
      const ids = [...matchedCustomerIds];
      if (!ids.length) return NextResponse.json({ data: [], count: 0, page, page_size: pageSize, role: account.role, can_assign: false, can_handover: false });
      query = query.in("id", ids);
    }
    if (customerId) query = query.eq("id", customerId);
    const allowedSort = new Set(["company_name", "contact_name", "country", "industry", "phone", "email", "website", "google_url", "ai_score", "status", "last_contact_time", "owner_id", "source", "source_batch", "created_at", "updated_at"]);
    if (hasOptionalFields) ["website_email", "website_phone", "followup_status"].forEach((field) => allowedSort.add(field));
    const sortField = allowedSort.has(sort) ? sort : "updated_at";
    const from = (page - 1) * pageSize;
    const result = await query.order(sortField, { ascending: direction === "asc", nullsFirst: false }).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const rows = (result.data || []) as unknown as PoolDbRow[];
    const ownerIds = [...new Set(rows.flatMap((item) => [item.owner_id, item.created_by]).filter(Boolean))] as string[];
    const customerIds = rows.map((item) => item.id);
    const [owners, protections, supplements, verifiedContacts] = await Promise.all([
      ownerIds.length ? admin.from("users").select("id,name,email").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
      customerIds.length ? admin.from("customer_protection").select("customer_id,owner_id,expire_date,status,extension_count,start_date").in("customer_id", customerIds).order("start_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      customerIds.length ? admin.from("customer_private_supplements").select("id,customer_id,field_name,value_raw,source_type,source_batch,source_row,created_at").eq("submitted_by", account.id).in("customer_id", customerIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      customerIds.length ? admin.from("customer_contacts").select("customer_id,type,value_raw,source_channel,exact_source_url,verification_status,contact_status,captured_at").in("customer_id", customerIds).in("verification_status", ["MATCHED_ORIGINAL", "NEW_VERIFIED", "CONFLICTING_VERIFIED"]).order("captured_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (owners.error) throw owners.error;
    if (protections.error) throw protections.error;
    if (supplements.error) throw supplements.error;
    // Contact evidence enriches the list only.  A production schema/cache
    // rollout that temporarily cannot expose this optional table must never
    // make the entire customer public pool unavailable.
    const verifiedContactsData = verifiedContacts.error ? [] : verifiedContacts.data || [];
    const ownerById = new Map((owners.data || []).map((item) => [item.id, item]));
    const protectionByCustomer = new Map<string, Record<string, unknown>>();
    for (const item of protections.data || []) if (!protectionByCustomer.has(item.customer_id)) protectionByCustomer.set(item.customer_id, item);
    const supplementsByCustomer = new Map<string, Record<string, unknown>[]>();
    for (const item of supplements.data || []) supplementsByCustomer.set(item.customer_id, [...(supplementsByCustomer.get(item.customer_id) || []), item]);
    const verifiedContactsByCustomer = new Map<string, Record<string, unknown>[]>();
    for (const item of verifiedContactsData) verifiedContactsByCustomer.set(item.customer_id, [...(verifiedContactsByCustomer.get(item.customer_id) || []), item]);
    const directReportIds = new Set(account.role === "SUPERVISOR" ? (directReports.data || []).map((item) => item.id) : []);
    const data = rows.map((row) => {
      const own = row.owner_id === account.id;
      const teamRead = account.role === "ADMIN" || directReportIds.has(String(row.owner_id || ""));
      const full = tab !== "claimed" || own || teamRead;
      const websiteEmail = "website_email" in row ? row.website_email : null;
      const websitePhone = "website_phone" in row ? row.website_phone : null;
      const verifiedWebsite = verifiedContactsByCustomer.get(row.id)?.find((item) =>
        item.type === "WEBSITE" && ["MATCHED_ORIGINAL", "NEW_VERIFIED"].includes(String(item.verification_status || ""))
      )?.value_raw || null;
      return {
        ...row,
        followup_status: "followup_status" in row ? row.followup_status : "WAITING_CONTACT",
        contact_name: full ? row.contact_name : row.contact_name ? "****" : null,
        phone: full ? row.phone : maskPhone(row.phone),
        whatsapp: full ? row.whatsapp : maskPhone(row.whatsapp),
        email: full ? row.email : maskEmail(row.email),
        website_phone: full ? websitePhone : maskPhone(websitePhone),
        website_email: full ? websiteEmail : maskEmail(websiteEmail),
        address: full ? row.address : maskAddress(row.address),
        website: full ? row.website || verifiedWebsite : null,
        google_url: full ? row.google_url : null,
        facebook_url: full ? row.facebook_url : null,
        instagram_url: full ? row.instagram_url : null,
        linkedin_url: full ? row.linkedin_url : null,
        tiktok_url: full ? row.tiktok_url : null,
        other_public_urls: full ? row.other_public_urls : [],
        contact_masked: !full,
        owner: row.owner_id ? ownerById.get(row.owner_id) || null : null,
        creator: row.created_by ? ownerById.get(String(row.created_by)) || null : null,
        protection: protectionByCustomer.get(row.id) || null,
        my_supplements: supplementsByCustomer.get(row.id) || [],
        verified_contacts: full ? verifiedContactsByCustomer.get(row.id) || [] : [],
        can_claim: tab === "available" && hasPermission(account, "customers.claim") && ["SALES", "SUPERVISOR", "ADMIN"].includes(account.role),
        // 未认领公海客户对所有具备客户查看权限的用户开放基础详情；
        // 已认领客户仍仅归属人和具备全量数据权限的角色可打开完整详情。
        can_open_customer: tab === "available" || own || teamRead,
      };
    });
    return NextResponse.json({
      data,
      count: result.count || 0,
      page,
      page_size: pageSize,
      role: account.role,
      restricted_batch_view: restrictedBatchView,
      restricted_batches: restrictedBatchView ? RESTRICTED_POOL_BATCHES : [],
      can_assign: account.role === "ADMIN",
      can_handover: account.role === "ADMIN",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "客户公海加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
