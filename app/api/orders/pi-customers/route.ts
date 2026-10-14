import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";

/** PI customer choices are always scoped to the signed-in owner's customers,
 * including when the signed-in user is an administrator. */
export async function GET() {
  try {
    const { supabase, account } = await requirePermission("orders.create");
    const customers: Array<{ id: string; company_name: string; country: string | null; contact_name: string | null; phone: string | null; email: string | null; address: string | null }> = [];
    for (let offset = 0;; offset += 1000) {
      const { data, error } = await supabase.from("customers")
        .select("id,company_name,country,contact_name,phone,email,address")
        .eq("owner_id", account.id)
        .is("deleted_at", null)
        .neq("status", "RELEASED")
        .order("company_name", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      customers.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    return NextResponse.json({ data: customers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PI客户加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
