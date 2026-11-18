import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignedSalesIds } from "@/lib/auth/order-clerk-scope";

/** PI customer choices are always scoped to the signed-in owner's customers,
 * including when the signed-in user is an administrator. */
export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.create");
    const isClerk = account.role === "ORDER_CLERK";
    const admin = isClerk ? createAdminClient() : null;
    const assigned = isClerk ? new Set(await assignedSalesIds(account.id)) : null;
    const salespeople = isClerk ? await admin!.from("users").select("id,name").in("role", ["SALES", "SUPERVISOR"]).eq("status", "ACTIVE").order("name") : null;
    if (salespeople?.error) throw salespeople.error;
    const allowedSalespeople = (salespeople?.data || []).filter((user) => assigned?.has(user.id));
    const selectedOwner = isClerk ? request.nextUrl.searchParams.get("sales_user_id") || "" : account.id;
    if (isClerk && selectedOwner && !allowedSalespeople.some((user) => user.id === selectedOwner)) throw new Error("FORBIDDEN");
    const customers: Array<{ id: string; company_name: string; country: string | null; contact_name: string | null; tax_number: string | null; tally_requirements: string | null; phone: string | null; email: string | null; address: string | null; shipping_address: string | null; shipping_addresses: string[] | null; shipping_contact_entries: Array<{ address: string; recipient: string; phone: string }> | null; forwarder_addresses: string[] | null; forwarder_contact_entries: Array<{ address: string; recipient: string; phone: string }> | null }> = [];
    if (isClerk && !selectedOwner) return NextResponse.json({ data: customers, is_clerk: true, salespeople: allowedSalespeople });
    for (let offset = 0;; offset += 1000) {
      const { data, error } = await (admin || supabase).from("customers")
        .select("id,company_name,country,contact_name,tax_number,tally_requirements,phone,email,address,shipping_address,shipping_addresses,shipping_contact_entries,forwarder_addresses,forwarder_contact_entries")
        .eq("owner_id", selectedOwner)
        .is("deleted_at", null)
        .neq("status", "RELEASED")
        .order("company_name", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      customers.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    return NextResponse.json({ data: customers, is_clerk: isClerk, salespeople: allowedSalespeople });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PI客户加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
