import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

/** Returns the importer's own basic-field snapshot from the conflict queue. */
export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("customer_conflicts")
      .select("id,customer_id,conflict_type,status,details,created_at")
      .order("created_at", { ascending: false });
    if (!error) return NextResponse.json({ data: data || [] });
    // Compatibility fallback for production before the optional migration is
    // applied. The snapshot is still scoped by audit_logs RLS to its importer.
    const fallback = await supabase.from("audit_logs")
      .select("target_id,content,created_at")
      .eq("action", "CUSTOMER_CONFLICT_DETECTED")
      .order("created_at", { ascending: false });
    if (fallback.error) throw fallback.error;
    return NextResponse.json({ data: (fallback.data || []).map((item) => ({
      id: `${item.target_id}-${item.created_at}`, customer_id: item.target_id,
      conflict_type: "CROSS_OWNER_DUPLICATE", status: "OPEN", details: item.content, created_at: item.created_at,
    })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "冲突客户加载失败" }, { status: 400 });
  }
}
