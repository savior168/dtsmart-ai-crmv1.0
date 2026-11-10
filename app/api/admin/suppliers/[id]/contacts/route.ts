import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };
const kindValid = (kind: unknown): kind is "PHONE" | "WECHAT" => kind === "PHONE" || kind === "WECHAT";

export async function GET(_: NextRequest, context: Context) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const { data, error } = await createAdminClient().from("supplier_private_contacts")
      .select("id,kind,value,created_at").eq("supplier_id", id).order("created_at");
    if (error) throw error;
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "联系方式加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const body = await request.json() as { kind?: unknown; value?: unknown };
    if (!kindValid(body.kind) || typeof body.value !== "string" || !body.value.trim() || body.value.trim().length > 200) {
      return NextResponse.json({ error: "请选择电话或微信，并填写不超过200字的联系方式" }, { status: 400 });
    }
    const admin = createAdminClient();
    const supplier = await admin.from("suppliers").select("id").eq("id", id).maybeSingle();
    if (supplier.error) throw supplier.error;
    if (!supplier.data) return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
    const { data, error } = await admin.from("supplier_private_contacts")
      .insert({ supplier_id: id, kind: body.kind, value: body.value.trim() })
      .select("id,kind,value,created_at").single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "联系方式保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
