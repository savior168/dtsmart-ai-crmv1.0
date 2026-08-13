import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

export async function POST(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    const { error } = await supabase.from("customers").update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
    await writeAudit(supabase, user.id, "CUSTOMER_RESTORE", "customer", id, {});
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "恢复失败" }, { status: 400 }); }
}
