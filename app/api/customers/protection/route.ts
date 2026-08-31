import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type CustomerRow = Record<string, unknown> & { id: string; created_at?: string };

export async function GET(request: NextRequest) {
  try {
    const { account } = await requireUser();
    const admin = createAdminClient();
    const scopeUserId = requestedOwnerId(request, account);
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90 * 86400000).toISOString();
    const summaryOnly = request.nextUrl.searchParams.get("summary") === "1";
    let protectionsQuery = admin.from("customer_protection").select("id,customer_id,type,start_date,expire_date,status").or(`status.eq.RELEASED,expire_date.lte.${now.toISOString()}`);
    let claimsQuery = admin.from("customer_claims").select("id,customer_id,created_at,released_at,release_reason").eq("action", "RELEASE").order("created_at", { ascending: false });
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
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const byCustomer = new Map<string, Record<string, unknown>>();
    for (const item of protections.data || []) {
      const customer = customerById.get(item.customer_id); if (!customer) continue;
      byCustomer.set(item.customer_id, { ...item, release_type: item.status === "RELEASED" ? "MANUAL" : "AUTO", customer });
    }
    for (const item of claims.data || []) {
      const customer = customerById.get(item.customer_id); if (!customer) continue;
      byCustomer.set(item.customer_id, { id: item.id, customer_id: item.customer_id, expire_date: item.released_at || item.created_at, status: "RELEASED", release_type: "MANUAL", release_reason: item.release_reason, customer });
    }
    for (const customer of expired.data || []) {
      if (byCustomer.has(customer.id)) continue;
      byCustomer.set(customer.id, { id: `expired-${customer.id}`, customer_id: customer.id, expire_date: new Date(new Date(customer.created_at).getTime() + 90 * 86400000).toISOString(), status: "EXPIRED", release_type: "AUTO", customer });
    }
    const data = Array.from(byCustomer.values()).sort((a, b) => String(b.expire_date || "").localeCompare(String(a.expire_date || "")));
    return NextResponse.json({ data, count: data.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保护到期数据加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
