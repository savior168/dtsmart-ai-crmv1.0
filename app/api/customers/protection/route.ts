import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type CustomerRow = Record<string, unknown> & { id: string; created_at?: string };

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("customers.view");
    const admin = createAdminClient();
    const scopeUserId = requestedOwnerId(request, account, "customers.data_all");
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90 * 86400000).toISOString();
    const summaryOnly = request.nextUrl.searchParams.get("summary") === "1";
    let protectionsQuery = admin.from("customer_protection").select("id,customer_id,owner_id,type,start_date,expire_date,status,extension_count,last_extended_at").or(`status.eq.RELEASED,expire_date.lte.${now.toISOString()}`).order("start_date", { ascending: false });
    let claimsQuery = admin.from("customer_claims").select("id,customer_id,user_id,created_at,released_at,release_reason").eq("action", "RELEASE").order("created_at", { ascending: false });
    let expiredQuery = admin.from("customers").select(summaryOnly ? "id" : "*").is("deleted_at", null).lt("created_at", cutoff).not("status", "in", "(QUOTE,DEAL)");
    if (scopeUserId) {
      protectionsQuery = protectionsQuery.eq("owner_id", scopeUserId);
      claimsQuery = claimsQuery.eq("user_id", scopeUserId);
      expiredQuery = expiredQuery.eq("owner_id", scopeUserId);
    }
    const [protections, claims, expired] = await Promise.all([protectionsQuery, claimsQuery, expiredQuery]);
    if (protections.error) throw protections.error;
    if (claims.error) throw claims.error;
    if (expired.error) throw expired.error;
    const customerIds = Array.from(new Set([...(protections.data || []).map((item) => item.customer_id), ...(claims.data || []).map((item) => item.customer_id), ...(expired.data || []).map((item) => item.id)]));
    if (summaryOnly) return NextResponse.json({ count: customerIds.length }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
    const customers: CustomerRow[] = [];
    for (let offset = 0; offset < customerIds.length; offset += 200) {
      const page = await admin.from("customers").select("*").in("id", customerIds.slice(offset, offset + 200));
      if (page.error) throw page.error;
      customers.push(...((page.data || []) as CustomerRow[]));
    }
    const ownerIds = Array.from(new Set([
      ...customers.map((customer) => String(customer.owner_id || "")),
      ...(protections.data || []).map((item) => String(item.owner_id || "")),
      ...(claims.data || []).map((item) => String(item.user_id || "")),
    ].filter(Boolean)));
    const owners = ownerIds.length ? await admin.from("users").select("id,name,email").in("id", ownerIds) : { data: [], error: null };
    if (owners.error) throw owners.error;
    const ownerById = new Map((owners.data || []).map((owner) => [owner.id, owner]));
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const byCustomer = new Map<string, Record<string, unknown>>();
    for (const item of protections.data || []) {
      const customer = customerById.get(item.customer_id); if (!customer) continue;
      if (byCustomer.has(item.customer_id)) continue;
      const currentOwnerId = String(customer.owner_id || "");
      const expiry = item.expire_date ? new Date(item.expire_date).getTime() : 0;
      const isOwnCurrentCustomer = currentOwnerId === account.id && item.owner_id === account.id;
      const inGrace = expiry > 0 && now.getTime() >= expiry && now.getTime() <= expiry + 7 * 86400000;
      const canRenew = item.status !== "RELEASED" && customer.status !== "DEAL" && isOwnCurrentCustomer && inGrace && Number(item.extension_count || 0) < 2;
      const renewalBlockReason = currentOwnerId && currentOwnerId !== item.owner_id
        ? "客户已转归其他用户，不可续期"
        : account.id !== item.owner_id
          ? "跨用户数据仅供查看"
          : item.status === "RELEASED"
            ? "客户已主动释放"
            : Number(item.extension_count || 0) >= 2
              ? "本保护周期已续期2次"
              : !inGrace ? "7天续期宽限期已结束" : null;
      byCustomer.set(item.customer_id, { ...item, release_type: item.status === "RELEASED" ? "MANUAL" : "AUTO", can_renew: canRenew, renewal_block_reason: renewalBlockReason, customer: { ...customer, owner: ownerById.get(currentOwnerId) || null } });
    }
    const latestClaims = new Map<string, { id: string; customer_id: string; user_id: string; created_at: string; released_at?: string | null; release_reason?: string | null }>();
    for (const item of claims.data || []) if (!latestClaims.has(item.customer_id)) latestClaims.set(item.customer_id, item);
    for (const item of latestClaims.values()) {
      const customer = customerById.get(item.customer_id); if (!customer) continue;
      const existing = byCustomer.get(item.customer_id);
      if (existing && new Date(String(existing.start_date || 0)).getTime() > new Date(String(item.created_at || 0)).getTime()) continue;
      const currentOwnerId = String(customer.owner_id || "");
      byCustomer.set(item.customer_id, { id: item.id, customer_id: item.customer_id, owner_id: item.user_id, expire_date: item.released_at || item.created_at, status: "RELEASED", release_type: "MANUAL", release_reason: item.release_reason, extension_count: 0, can_renew: false, renewal_block_reason: currentOwnerId && currentOwnerId !== item.user_id ? "客户已转归其他用户，不可续期" : "客户已主动释放", customer: { ...customer, owner: ownerById.get(currentOwnerId) || null } });
    }
    for (const customer of expired.data || []) {
      if (byCustomer.has(customer.id)) continue;
      const expireDate = new Date(new Date(customer.created_at).getTime() + 90 * 86400000);
      const currentOwnerId = String(customer.owner_id || "");
      const inGrace = now.getTime() <= expireDate.getTime() + 7 * 86400000;
      byCustomer.set(customer.id, { id: `expired-${customer.id}`, customer_id: customer.id, owner_id: currentOwnerId, expire_date: expireDate.toISOString(), status: "EXPIRED", release_type: "AUTO", extension_count: 0, can_renew: currentOwnerId === account.id && inGrace, renewal_block_reason: currentOwnerId !== account.id ? "跨用户数据仅供查看" : inGrace ? null : "7天续期宽限期已结束", customer: { ...customer, owner: ownerById.get(currentOwnerId) || null } });
    }
    const data = Array.from(byCustomer.values()).sort((a, b) => String(b.expire_date || "").localeCompare(String(a.expire_date || "")));
    return NextResponse.json({ data, count: data.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保护到期数据加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requirePermission("customers.renew");
    const body = await request.json() as { customer_id?: string };
    if (!body.customer_id) return NextResponse.json({ error: "缺少客户ID" }, { status: 400 });
    const renewed = await supabase.rpc("renew_customer_protection", { p_customer_id: body.customer_id });
    if (renewed.error) throw renewed.error;
    return NextResponse.json({ success: true, data: renewed.data, message: "保护期已续期45天" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "客户保护续期失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
