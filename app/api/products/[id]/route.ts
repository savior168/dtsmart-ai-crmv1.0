import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNormalizedProduct } from "@/lib/product-import";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requirePermission("products.manage");
    const { id } = await context.params;
    const body = await request.json();
    const { normalized, issues } = validateNormalizedProduct(body);
    if (issues.some((issue) => issue.includes("商品名称"))) return NextResponse.json({ error: issues.join("；") }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin.from("products").update({
      name_zh: normalized.name_zh, name_en: normalized.name_en || null,
      brand: normalized.brand || null, model: normalized.model || null, part_type: normalized.part_type || null,
      quality: normalized.quality || null, color: normalized.color || null, packaging: normalized.packaging || null,
      description_zh: normalized.description_zh || null, description_en: normalized.description_en || null,
      aliases: normalized.aliases, unit: normalized.unit, minimum_order_quantity: normalized.minimum_order_quantity,
      is_active: body.is_active !== false, updated_by: user.id, updated_at: new Date().toISOString(),
      category_id: body.category_id || null, image_url: String(body.image_url || "").trim() || null,
      supplier_code: String(body.supplier_code || normalized.sku || "").trim() || null,
      supplier_source: String(body.supplier_source || "").trim() || null,
    }).eq("id", id).select("*").single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "PRODUCT_UPDATE", "product", id, { sku: data.sku, is_active: data.is_active });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
