import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.create");
    const { id } = await params;
    const { revision } = await request.json() as { revision?: number };
    if (!Number.isInteger(revision) || Number(revision) < 1) throw new Error("PI草稿版本不正确，请刷新");
    const { data, error } = await supabase.rpc("submit_direct_pi_order", {
      p_order_id: id, p_expected_revision: revision,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI提交仓库失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
