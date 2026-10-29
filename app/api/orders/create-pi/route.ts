import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { isPiOrderNumberConflict, sqlErrorMessage } from "@/lib/sales-flow";
import { parsePiOrderInput, requireOwnedPiCustomer } from "@/lib/pi-order-input";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.create");
    if (!["SALES", "SUPERVISOR", "ADMIN", "ORDER_CLERK"].includes(account.role)) throw new Error("FORBIDDEN");
    const body = await request.json() as Record<string, unknown>;
    if (body.fx_rate_confirmed !== true) throw new Error("请核对汇率参考来源并确认后再保存PI");
    const input = parsePiOrderInput(body);
    const salesUserId = account.role === "ORDER_CLERK" ? String(body.sales_user_id || "") : account.id;
    if (account.role === "ORDER_CLERK") {
      const admin = createAdminClient();
      const [seller, customer] = await Promise.all([
        admin.from("users").select("id").eq("id", salesUserId).in("role", ["SALES", "SUPERVISOR"]).eq("status", "ACTIVE").maybeSingle(),
        admin.from("customers").select("id,owner_id").eq("id", input.p_customer_id).is("deleted_at", null).neq("status", "RELEASED").maybeSingle(),
      ]);
      if (seller.error) throw seller.error;
      if (customer.error) throw customer.error;
      if (!seller.data || !customer.data || customer.data.owner_id !== salesUserId) throw new Error("所选销售员或主管与客户归属不匹配");
    } else await requireOwnedPiCustomer(supabase, account.id, input.p_customer_id);
    const { data, error } = await supabase.rpc("create_direct_pi_order_with_fees", { ...input, p_sales_user_id: salesUserId });
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI订单创建失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || (isPiOrderNumberConflict(error) ? 409 : 400) });
  }
}
