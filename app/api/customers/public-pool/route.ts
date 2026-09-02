import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { postgrestContains } from "@/lib/postgrest-search";

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
    const allowed = new Set(["available", "claimed", "pending"]);
    if (!allowed.has(tab)) return NextResponse.json({ error: "无效的公海分类" }, { status: 400 });
    if (tab === "pending" && account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可以查看待分配客户" }, { status: 403 });

    let query = admin.from("customers").select(
      "id,company_name,country,address,industry,category,phone,email,website,google_url,ai_level,ai_score,is_target_customer,business_scope,source,owner_id,pool_status,acquisition_scope,assigned_via,claimed_at,status,updated_at",
      { count: "exact" },
    ).is("deleted_at", null);
    if (tab === "available") query = query.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "AVAILABLE").is("owner_id", null);
    if (tab === "claimed") query = query.eq("acquisition_scope", "PUBLIC_POOL").eq("pool_status", "CLAIMED").not("owner_id", "is", null);
    if (tab === "pending") query = query.eq("acquisition_scope", "PRIVATE").eq("pool_status", "PENDING_ALLOCATION").is("owner_id", null);
    if (search) {
      const pattern = postgrestContains(search.replace(/[(),]/g, " "));
      query = query.or(`company_name.ilike.${pattern},country.ilike.${pattern},industry.ilike.${pattern}`);
    }
    const from = (page - 1) * pageSize;
    const result = await query.order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const ownerIds = [...new Set(rows.map((item) => item.owner_id).filter(Boolean))] as string[];
    const customerIds = rows.map((item) => item.id);
    const [owners, protections] = await Promise.all([
      ownerIds.length ? admin.from("users").select("id,name,email").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
      customerIds.length ? admin.from("customer_protection").select("customer_id,owner_id,expire_date,status,extension_count,start_date").in("customer_id", customerIds).order("start_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (owners.error) throw owners.error;
    if (protections.error) throw protections.error;
    const ownerById = new Map((owners.data || []).map((item) => [item.id, item]));
    const protectionByCustomer = new Map<string, Record<string, unknown>>();
    for (const item of protections.data || []) if (!protectionByCustomer.has(item.customer_id)) protectionByCustomer.set(item.customer_id, item);
    const elevated = account.role === "ADMIN" || account.role === "SUPERVISOR";
    const data = rows.map((row) => {
      const own = row.owner_id === account.id;
      const full = tab !== "claimed" || own || elevated;
      return {
        ...row,
        phone: full ? row.phone : maskPhone(row.phone),
        email: full ? row.email : maskEmail(row.email),
        address: full ? row.address : maskAddress(row.address),
        website: full ? row.website : null,
        google_url: full ? row.google_url : null,
        contact_masked: !full,
        owner: row.owner_id ? ownerById.get(row.owner_id) || null : null,
        protection: protectionByCustomer.get(row.id) || null,
        can_claim: tab === "available" && hasPermission(account, "customers.claim") && ["SALES", "SUPERVISOR"].includes(account.role),
        can_open_customer: own || elevated,
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
