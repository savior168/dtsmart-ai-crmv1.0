import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { postgrestContains } from "@/lib/postgrest-search";

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
};

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
    await admin.rpc("refresh_expired_public_customers");
    const params = request.nextUrl.searchParams;
    const tab = params.get("tab") || "available";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("page_size") || 20)));
    const search = params.get("q")?.trim() || "";
    const country = params.get("country")?.trim() || "";
    const industry = params.get("industry")?.trim() || "";
    const aiLevel = params.get("ai_level")?.trim().toUpperCase() || "";
    const target = params.get("target")?.trim() || "";
    const customerStatus = params.get("status")?.trim().toUpperCase() || "";
    const ownerId = params.get("owner_id")?.trim() || "";
    const customerId = params.get("customer_id")?.trim() || "";
    const sort = params.get("sort") || "updated_at";
    const direction = params.get("direction") === "asc" ? "asc" : "desc";
    if (params.get("counts") === "1") {
      const baseCount = () => admin.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null);
      const availableQuery = baseCount().eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "AVAILABLE").eq("status", "UNCLAIMED").is("owner_id", null);
      const claimedQuery = baseCount().eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "CLAIMED").neq("status", "UNCLAIMED").not("owner_id", "is", null);
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
    if (params.get("export") === "1" && account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可以导出客户公海数据" }, { status: 403 });
    if (ownerId && !elevated) return NextResponse.json({ error: "当前角色不能按他人归属筛选" }, { status: 403 });

    if (params.get("options") === "1") {
      const optionRows: Array<{ industry: string | null; owner_id: string | null }> = [];
      for (let offset = 0; offset < 20000; offset += 1000) {
        let optionQuery = admin.from("customers").select("industry,owner_id").is("deleted_at", null);
        if (tab === "available") optionQuery = optionQuery.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "AVAILABLE").eq("status", "UNCLAIMED").is("owner_id", null);
        if (tab === "claimed") optionQuery = optionQuery.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "CLAIMED").neq("status", "UNCLAIMED").not("owner_id", "is", null);
        if (tab === "pending") optionQuery = optionQuery.eq("acquisition_scope", "PRIVATE").eq("pool_status", "PENDING_ALLOCATION").eq("status", "UNCLAIMED").is("owner_id", null);
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
      const unique = (values: Array<string | null>) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "zh-CN"));
      return NextResponse.json({
        industries: unique(optionRows.map((item) => item.industry)),
        owners: owners.data || [],
      }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
    }

    // Website contact and follow-up status are compatibility columns. Probe
    // them together so older production schemas keep the public-pool usable.
    const optionalProbe = await admin.from("customers").select("website_email,website_phone,followup_status").limit(1);
    const hasOptionalFields = !optionalProbe.error;
    const optionalSelect = hasOptionalFields ? ",website_email,website_phone,followup_status" : "";
    let query = admin.from("customers").select(
      `id,company_name,contact_name,country,address,industry,category,phone,whatsapp,email,website,google_url,ai_level,ai_score,ai_screening_done,is_target_customer,business_scope,source,created_by,owner_id,pool_status,acquisition_scope,assigned_via,claimed_at,status,last_contact_time,created_at,updated_at${optionalSelect}`,
      { count: "exact" },
    ).is("deleted_at", null);
    if (tab === "available") query = query.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "AVAILABLE").eq("status", "UNCLAIMED").is("owner_id", null);
    if (tab === "claimed") query = query.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "CLAIMED").neq("status", "UNCLAIMED").not("owner_id", "is", null);
    if (tab === "pending") query = query.eq("acquisition_scope", "PRIVATE").eq("pool_status", "PENDING_ALLOCATION").eq("status", "UNCLAIMED").is("owner_id", null);
    if (search) {
      const pattern = postgrestContains(search.replace(/[(),]/g, " "));
      query = query.or(`company_name.ilike.${pattern},country.ilike.${pattern},industry.ilike.${pattern}`);
    }
    if (country) query = query.eq("country", country);
    if (industry) query = query.eq("industry", industry);
    if (["A", "B", "C", "D"].includes(aiLevel)) query = query.eq("ai_level", aiLevel);
    if (target === "valid") query = query.eq("is_target_customer", true);
    if (target === "invalid") query = query.eq("is_target_customer", false);
    if (target === "pending") query = query.is("is_target_customer", null);
    if (tab === "claimed" && ["CLAIMED", "FOLLOWING", "QUOTE", "DEAL", "RELEASED"].includes(customerStatus)) query = query.eq("status", customerStatus);
    if (ownerId && tab === "claimed") query = query.eq("owner_id", ownerId);
    if (customerId) query = query.eq("id", customerId);
    const allowedSort = new Set(["company_name", "contact_name", "country", "industry", "phone", "email", "website", "google_url", "ai_score", "status", "last_contact_time", "owner_id", "source", "created_at", "updated_at"]);
    if (hasOptionalFields) ["website_email", "website_phone", "followup_status"].forEach((field) => allowedSort.add(field));
    const sortField = allowedSort.has(sort) ? sort : "updated_at";
    const from = (page - 1) * pageSize;
    const result = await query.order(sortField, { ascending: direction === "asc", nullsFirst: false }).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const rows = (result.data || []) as unknown as PoolDbRow[];
    const ownerIds = [...new Set(rows.flatMap((item) => [item.owner_id, item.created_by]).filter(Boolean))] as string[];
    const customerIds = rows.map((item) => item.id);
    const [owners, protections, supplements] = await Promise.all([
      ownerIds.length ? admin.from("users").select("id,name,email").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
      customerIds.length ? admin.from("customer_protection").select("customer_id,owner_id,expire_date,status,extension_count,start_date").in("customer_id", customerIds).order("start_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      customerIds.length ? admin.from("customer_private_supplements").select("id,customer_id,field_name,value_raw,source_type,source_batch,source_row,created_at").eq("submitted_by", account.id).in("customer_id", customerIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (owners.error) throw owners.error;
    if (protections.error) throw protections.error;
    if (supplements.error) throw supplements.error;
    const ownerById = new Map((owners.data || []).map((item) => [item.id, item]));
    const protectionByCustomer = new Map<string, Record<string, unknown>>();
    for (const item of protections.data || []) if (!protectionByCustomer.has(item.customer_id)) protectionByCustomer.set(item.customer_id, item);
    const supplementsByCustomer = new Map<string, Record<string, unknown>[]>();
    for (const item of supplements.data || []) supplementsByCustomer.set(item.customer_id, [...(supplementsByCustomer.get(item.customer_id) || []), item]);
    const directReportIds = account.role === "SUPERVISOR" && ownerIds.length
      ? new Set((await admin.from("users").select("id").in("id", ownerIds).eq("manager_id", account.id).eq("status", "ACTIVE")).data?.map((item) => item.id) || [])
      : new Set<string>();
    const data = rows.map((row) => {
      const own = row.owner_id === account.id;
      const teamRead = account.role === "ADMIN" || directReportIds.has(String(row.owner_id || ""));
      const full = tab !== "claimed" || own || teamRead;
      const websiteEmail = "website_email" in row ? row.website_email : null;
      const websitePhone = "website_phone" in row ? row.website_phone : null;
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
        website: full ? row.website : null,
        google_url: full ? row.google_url : null,
        contact_masked: !full,
        owner: row.owner_id ? ownerById.get(row.owner_id) || null : null,
        creator: row.created_by ? ownerById.get(String(row.created_by)) || null : null,
        protection: protectionByCustomer.get(row.id) || null,
        my_supplements: supplementsByCustomer.get(row.id) || [],
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
      can_assign: account.role === "ADMIN",
      can_handover: account.role === "ADMIN",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "客户公海加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
