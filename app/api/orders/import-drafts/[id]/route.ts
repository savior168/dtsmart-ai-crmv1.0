import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { supabase, account } = await requirePermission("orders.import");
    const { id } = await context.params;
    const { data, error } = await supabase.from("pi_import_drafts")
      .select("id,owner_id,source_file_name,source_sheet_name,source_order_number,payload,revision,status,converted_order_id,created_at,updated_at")
      .eq("id", id).eq("owner_id", account.id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "导入草稿不存在或不归属您" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI导入草稿加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { supabase } = await requirePermission("orders.import");
    const { id } = await context.params;
    const body = await request.json() as { revision?: number };
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) throw new Error("导入草稿版本不正确");
    const { error } = await supabase.rpc("delete_pi_import_draft", { p_draft_id: id, p_expected_revision: body.revision });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI导入草稿删除失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
