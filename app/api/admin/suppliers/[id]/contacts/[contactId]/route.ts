import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string; contactId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    await requireAdmin();
    const { id, contactId } = await context.params;
    const body = await request.json() as { value?: unknown };
    if (typeof body.value !== "string" || !body.value.trim() || body.value.trim().length > 200) {
      return NextResponse.json({ error: "请填写不超过200字的联系方式" }, { status: 400 });
    }
    const { data, error } = await createAdminClient().from("supplier_private_contacts")
      .update({ value: body.value.trim(), updated_at: new Date().toISOString() })
      .eq("id", contactId).eq("supplier_id", id).select("id,kind,value,created_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "联系方式不存在" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "联系方式修改失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function DELETE(_: NextRequest, context: Context) {
  try {
    await requireAdmin();
    const { id, contactId } = await context.params;
    const { data, error } = await createAdminClient().from("supplier_private_contacts")
      .delete().eq("id", contactId).eq("supplier_id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "联系方式不存在" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "联系方式删除失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
