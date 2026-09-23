import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProductFamily } from "@/lib/product-specifications";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requirePermission("products.manage");
    const { id } = await context.params;
    const body = await request.json();
    const name = String(body.name_zh || "").trim();
    if (!name) return NextResponse.json({ error: "中文名称为必填项" }, { status: 400 });
    if (!isProductFamily(body.product_family)) return NextResponse.json({ error: "请选择有效的商品规格类型" }, { status: 400 });
    const admin = createAdminClient();
    const current = await admin.from("product_categories").select("product_family").eq("id", id).single();
    if (current.error) throw current.error;
    if (current.data.product_family !== body.product_family) {
      const linked = await admin.from("products").select("id", { count: "exact", head: true }).eq("category_id", id);
      if (linked.error) throw linked.error;
      if ((linked.count || 0) > 0) return NextResponse.json({ error: "该分类已有商品，不能直接改变规格类型；请先逐商品核对并迁移至正确分类" }, { status: 409 });
    }
    const { data, error } = await admin.from("product_categories").update({
      name_zh: name, name_en: String(body.name_en || "").trim() || null,
      product_family: body.product_family,
      sort_order: Number(body.sort_order) || 0, is_active: body.is_active !== false,
      updated_at: new Date().toISOString(),
    }).eq("id", id).select("*").single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "PRODUCT_CATEGORY_UPDATE", "product_category", id, { code: data.code, name_zh: name, is_active: data.is_active });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品分类保存失败";
    return NextResponse.json({ error: message }, { status: message.includes("duplicate") ? 409 : authErrorStatus(message) || 500 });
  }
}
