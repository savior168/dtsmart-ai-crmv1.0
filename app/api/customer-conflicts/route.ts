import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type ConflictRow = { id: string; customer_id: string | null; conflict_type: string; status: string; details: Record<string, unknown>; created_at: string };

async function withOwner(rows: ConflictRow[]) {
  const admin = createAdminClient();
  const customerIds = Array.from(new Set(rows.map((item) => item.customer_id).filter((id): id is string => Boolean(id))));
  if (!customerIds.length) return rows.map((item) => ({ ...item, owner: null }));
  const { data: customers, error } = await admin.from("customers").select("id,owner_id").in("id", customerIds);
  if (error) throw error;
  const ownerIds = Array.from(new Set((customers || []).map((item) => item.owner_id).filter((id): id is string => Boolean(id))));
  const users = ownerIds.length ? await admin.from("users").select("id,name").in("id", ownerIds) : { data: [], error: null };
  if (users.error) throw users.error;
  const ownerById = new Map((users.data || []).map((item) => [item.id, { id: item.id, name: item.name || "未命名用户" }]));
  const customerOwner = new Map((customers || []).map((item) => [item.id, ownerById.get(item.owner_id) || (item.owner_id ? { id: item.owner_id, name: "已归属其他用户" } : null)]));
  return rows.map((item) => ({ ...item, owner: item.customer_id ? customerOwner.get(item.customer_id) || null : null }));
}

/** Returns the importer's own basic-field snapshot from the conflict queue. */
export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("customer_conflicts")
      .select("id,customer_id,conflict_type,status,details,created_at")
      .order("created_at", { ascending: false });
    if (!error) return NextResponse.json({ data: await withOwner((data || []) as ConflictRow[]) });
    // Compatibility fallback for production before the optional migration is
    // applied. The snapshot is still scoped by audit_logs RLS to its importer.
    const fallback = await supabase.from("audit_logs")
      .select("target_id,content,created_at")
      .eq("action", "CUSTOMER_CONFLICT_DETECTED")
      .order("created_at", { ascending: false });
    if (fallback.error) throw fallback.error;
    const fallbackRows = (fallback.data || []).map((item) => ({
      id: `${item.target_id}-${item.created_at}`, customer_id: item.target_id,
      conflict_type: "CROSS_OWNER_DUPLICATE", status: "OPEN", details: ((item.content as Record<string, unknown>)?.details || item.content || {}) as Record<string, unknown>, created_at: item.created_at,
    }));
    return NextResponse.json({ data: await withOwner(fallbackRows as ConflictRow[]) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "冲突客户加载失败" }, { status: 400 });
  }
}
