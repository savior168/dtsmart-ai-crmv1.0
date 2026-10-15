import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { parsePiOrderInput, requireOwnedPiCustomer } from "@/lib/pi-order-input";

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.create");
    if (account.role !== "SALES" && account.role !== "SUPERVISOR" && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const body = await request.json() as Record<string, unknown>;
    const input = parsePiOrderInput(body);
    await requireOwnedPiCustomer(supabase, account.id, input.p_customer_id);
    const { data, error } = await supabase.rpc("create_direct_pi_order", input);
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI订单创建失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
