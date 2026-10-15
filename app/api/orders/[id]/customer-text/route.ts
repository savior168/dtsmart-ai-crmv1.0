import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.edit");
    const { id } = await params;
    const body = await request.json();
    if (!Number.isInteger(body.revision) || body.revision < 1 || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 500) {
      throw new Error("PI版本或英文产品明细无效，请刷新后重试");
    }
    const rows = body.items.map((item: Record<string, unknown>) => ({
      line_number: Number(item.line_number),
      quality_en: String(item.quality_en || "").trim(),
      description_en: String(item.description_en || "").trim(),
    }));
    if (rows.some((row: { line_number: number; quality_en: string; description_en: string }) => !Number.isInteger(row.line_number) || row.line_number < 1 || row.quality_en.length > 160 || row.description_en.length > 1000 || /[\u3400-\u9fff]/u.test(row.quality_en + row.description_en))) {
      throw new Error("英文质量和描述不能包含中文，且长度不能超过原字段上限");
    }
    const { data, error } = await supabase.rpc("save_direct_pi_customer_text", {
      p_order_id: id, p_expected_revision: body.revision, p_rows: rows,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "客户英文内容保存失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
