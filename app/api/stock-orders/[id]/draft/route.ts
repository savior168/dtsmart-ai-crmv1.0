import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePermission("stock.prepare");
    const { id } = await params;
    const body = await request.json();
    const items = Array.isArray(body.items)
      ? body.items.map((item: Record<string, unknown>, index: number) => ({
          line_number: index + 1,
          description_zh: String(item.description_zh || "").trim(),
          preparation_requirement: String(
            item.preparation_requirement || "",
          ).trim(),
        }))
      : [];
    const { data, error } = await supabase.rpc("update_stock_order_draft", {
      p_stock_order_id: id,
      p_stocking_requirements: String(body.stocking_requirements || "").trim(),
      p_expected_ready_at: String(body.expected_ready_at || "") || null,
      p_items: items,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货信息保存失败");
    return NextResponse.json(
      { error: message },
      { status: authErrorStatus(message) || 400 },
    );
  }
}
