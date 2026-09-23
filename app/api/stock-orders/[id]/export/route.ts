import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { buildStockWorkbook } from "@/lib/template-xlsx";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("stock.export");
    const { id } = await context.params;
    const [{ data: order, error }, { data: items, error: itemError }] = await Promise.all([
      supabase.from("stock_orders").select("stock_number,quote_number,order_number,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,created_at,salesperson:users!stock_orders_sales_user_id_fkey(name,email)").eq("id", id).single(),
      supabase.from("stock_order_items").select("line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,procurement_cost,procurement_cost_confirmed,quantity,preparation_requirement").eq("stock_order_id", id).order("line_number"),
    ]);
    if (error) throw error;
    if (itemError) throw itemError;
    if(order.status==="DRAFT")throw new Error("请先完善备货信息并提交仓库，再导出标准备货单");
    const buffer = await buildStockWorkbook(order as never, (items || []) as never);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${order.stock_number}.xlsx`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单导出失败");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
