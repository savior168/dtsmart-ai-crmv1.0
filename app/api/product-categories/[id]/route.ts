import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requirePermission("products.manage");
    const { id } = await context.params;
    const body = await request.json();
    const code = String(body.code || "").trim().toUpperCase();
    const name = String(body.name_zh || "").trim();
    if (!code || !name) return NextResponse.json({ error: "分类编码和中文名称为必填项" }, { status: 400 });
    const { data, error } = await createAdminClient().from("product_categories").update({
      code, name_zh: name, name_en: String(body.name_en || "").trim() || null,
      sort_order: Number(body.sort_order) || 0, is_active: body.is_active !== false,
      updated_at: new Date().toISOString(),
    }).eq("id", id).select("*").single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "PRODUCT_CATEGORY_UPDATE", "product_category", id, { code, name_zh: name, is_active: data.is_active });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品分类保存失败";
    return NextResponse.json({ error: message }, { status: message.includes("duplicate") ? 409 : authErrorStatus(message) || 500 });
  }
}
