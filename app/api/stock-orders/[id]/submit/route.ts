import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePermission("stock.submit");
    const { id } = await params;
    const { data: stock, error: stockError } = await supabase.from("stock_orders")
      .select("status,warehouse_reference_number").eq("id", id).single();
    if (stockError) throw stockError;
    if (stock.status === "DRAFT" && stock.warehouse_reference_number) throw new Error("此备货单已撤回，请修改PI并重新提交");
    const { data, error } = await supabase.rpc("warehouse_submit_stock_draft", {
      p_stock_order_id: id,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "提交采购备货失败");
    return NextResponse.json(
      { error: message },
      { status: authErrorStatus(message) || 400 },
    );
  }
}
