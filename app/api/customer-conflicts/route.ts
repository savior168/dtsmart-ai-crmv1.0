import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerLookupIdentityKeys } from "@/lib/import-dedupe";

type ConflictRow = { id: string; customer_id: string | null; conflict_type: string; status: string; details: Record<string, unknown>; created_at: string };

function dedupeConflicts(rows: ConflictRow[]) {
  const seenCustomers = new Set<string>();
  const seenIdentities = new Set<string>();
  return rows.filter((item) => {
    const submitted = item.details?.submitted;
    const identity = submitted && typeof submitted === "object"
      ? customerLookupIdentityKeys(submitted as { company_name?: unknown; phone?: unknown; email?: unknown; website?: unknown; google_url?: unknown })
      : [];
    const customerKey = item.customer_id ? `customer:${item.customer_id}` : "";
    if ((customerKey && seenCustomers.has(customerKey)) || identity.some((key) => seenIdentities.has(key))) return false;
    if (customerKey) seenCustomers.add(customerKey);
    identity.forEach((key) => seenIdentities.add(key));
    return true;
  });
}

async function withOwner(rows: ConflictRow[]) {
  const admin = createAdminClient();
  const customerIds = Array.from(new Set(rows.map((item) => item.customer_id).filter((id): id is string => Boolean(id))));
  if (!customerIds.length) return rows.map((item) => ({ ...item, owner: null }));
  const { data: customers, error } = await admin.from("customers").select("id,owner_id,created_at,status").in("id", customerIds);
  if (error) throw error;
  const ownerIds = Array.from(new Set((customers || []).map((item) => item.owner_id).filter((id): id is string => Boolean(id))));
  const users = ownerIds.length ? await admin.from("users").select("id,name").in("id", ownerIds) : { data: [], error: null };
  if (users.error) throw users.error;
  const ownerById = new Map((users.data || []).map((item) => [item.id, { id: item.id, name: item.name || "未命名用户" }]));
  const customerOwner = new Map((customers || []).map((item) => [item.id, ownerById.get(item.owner_id) || (item.owner_id ? { id: item.owner_id, name: "已归属其他用户" } : null)]));
  const protections = await admin.from("customer_protection").select("customer_id,expire_date,status").in("customer_id", customerIds).eq("status", "ACTIVE").order("expire_date", { ascending: false });
  if (protections.error) throw protections.error;
  const expiryByCustomer = new Map((protections.data || []).map((item) => [item.customer_id, item.expire_date]));
  const customerById = new Map((customers || []).map((item) => [item.id, item]));
  return rows.map((item) => {
    const customer = item.customer_id ? customerById.get(item.customer_id) : null;
    const expiry = item.customer_id ? expiryByCustomer.get(item.customer_id) : null;
    const fallbackExpiry = customer?.created_at ? new Date(new Date(customer.created_at).getTime() + 90 * 86400000).toISOString() : null;
    const protectionDays = expiry || fallbackExpiry ? Math.max(0, Math.ceil((new Date(String(expiry || fallbackExpiry)).getTime() - Date.now()) / 86400000)) : 0;
    return { ...item, owner: item.customer_id ? customerOwner.get(item.customer_id) || null : null, protection_days: protectionDays };
  });
}

/** Returns the importer's own basic-field snapshot from the conflict queue. */
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const summaryOnly = request.nextUrl.searchParams.get("summary") === "1";
    const { data, error } = await supabase
      .from("customer_conflicts")
      .select("id,customer_id,conflict_type,status,details,created_at")
      .eq("reported_by", user.id)
      .order("created_at", { ascending: false });
    if (!error) {
      const unique = dedupeConflicts((data || []) as ConflictRow[]);
      if (summaryOnly) return NextResponse.json({ count: unique.length }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
      return NextResponse.json({ data: await withOwner(unique), count: unique.length });
    }
    // Compatibility fallback for production before the optional migration is
    // applied. The snapshot is still scoped by audit_logs RLS to its importer.
    const fallback = await supabase.from("audit_logs")
      .select("target_id,content,created_at")
      .eq("user_id", user.id)
      .eq("action", "CUSTOMER_CONFLICT_DETECTED")
      .order("created_at", { ascending: false });
    if (fallback.error) throw fallback.error;
    const fallbackRows = (fallback.data || []).map((item) => ({
      id: `${item.target_id}-${item.created_at}`, customer_id: item.target_id,
      conflict_type: "CROSS_OWNER_DUPLICATE", status: "OPEN", details: ((item.content as Record<string, unknown>)?.details || item.content || {}) as Record<string, unknown>, created_at: item.created_at,
    }));
    const unique = dedupeConflicts(fallbackRows as ConflictRow[]);
    if (summaryOnly) return NextResponse.json({ count: unique.length }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
    return NextResponse.json({ data: await withOwner(unique), count: unique.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "冲突客户加载失败" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { customer_id } = await request.json();
    if (!customer_id) return NextResponse.json({ error: "缺少客户ID" }, { status: 400 });
    const conflict = await createAdminClient().from("customer_conflicts").select("id").eq("reported_by", user.id).eq("customer_id", customer_id).limit(1).maybeSingle();
    if (conflict.error || !conflict.data) return NextResponse.json({ error: "该客户不在您的冲突记录中" }, { status: 403 });
    const { data, error } = await supabase.rpc("claim_customer", { p_customer_id: customer_id });
    if (error) throw error;
    return NextResponse.json({ ok: true, data, message: "客户认领成功" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "客户认领失败" }, { status: 400 });
  }
}
