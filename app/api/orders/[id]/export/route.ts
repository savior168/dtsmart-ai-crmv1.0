import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { buildQuoteWorkbook } from "@/lib/template-xlsx";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePermission("orders.export");
    const { id } = await params;
    const [order, items] = await Promise.all([
      supabase
        .from("sales_orders")
        .select(
          "order_number,currency,delivery_date,payment_method,customer_short_name,destination_country,shipping_cost,subtotal,total_amount,confirmed_at,owner:users!sales_orders_sales_user_id_fkey(name,email,phone),customer:customers(company_name,contact_name,phone)",
        )
        .eq("id", id)
        .single(),
      supabase
        .from("sales_order_items")
        .select(
          "line_number,item_name,brand,model,quality,description,quantity,unit_price",
        )
        .eq("sales_order_id", id)
        .order("line_number"),
    ]);
    if (order.error) throw order.error;
    if (items.error) throw items.error;
    const workbook = await buildQuoteWorkbook(
      {
        ...order.data,
        quote_number: order.data.order_number,
        created_at: order.data.confirmed_at,
      } as never,
      (items.data || []).map((item) => ({
        ...item,
        description_zh: null,
        procurement_cost: 0,
        preparation_requirement: null,
      })) as never,
    );
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${order.data.order_number}.xlsx`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = sqlErrorMessage(error, "订单导出失败");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
