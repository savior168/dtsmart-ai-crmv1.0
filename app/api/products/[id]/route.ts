import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNormalizedProduct } from "@/lib/product-import";
import { isProductFamily, normalizeProductSpecifications, type ProductFamily } from "@/lib/product-specifications";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requirePermission("products.manage");
    const { id } = await context.params;
    const body = await request.json();
    const { normalized, issues } = validateNormalizedProduct(body);
    if (issues.some((issue) => issue.includes("商品名称"))) return NextResponse.json({ error: issues.join("；") }, { status: 400 });
    if (!body.category_id) return NextResponse.json({ error: "请选择商品分类并核对对应规格" }, { status: 400 });
    if (body.minimum_order_quantity !== undefined && (!Number.isFinite(Number(body.minimum_order_quantity)) || Number(body.minimum_order_quantity) <= 0)) return NextResponse.json({ error: "最小起订量必须大于0" }, { status: 400 });
    const admin = createAdminClient();
    const current = await admin.from("products").select("category_id,specifications").eq("id", id).single();
    if (current.error) throw current.error;
    let family: ProductFamily = "OTHER";
    if (body.category_id) {
      const category = await admin.from("product_categories").select("product_family,is_active").eq("id", body.category_id).single();
      if (category.error || !isProductFamily(category.data?.product_family) || (!category.data.is_active && body.category_id !== current.data.category_id)) return NextResponse.json({ error: "请选择有效且已启用的商品分类" }, { status: 400 });
      family = category.data.product_family;
    }
    const checkedSpecs = normalizeProductSpecifications(body.specifications ?? current.data.specifications, family);
    if (checkedSpecs.error) return NextResponse.json({ error: checkedSpecs.error }, { status: 400 });
    const { data, error } = await admin.from("products").update({
      name_zh: normalized.name_zh, name_en: normalized.name_en || null,
      brand: normalized.brand || null, model: normalized.model || null, part_type: normalized.part_type || null,
      manufacturer_brand: String(body.manufacturer_brand || "").trim() || null,
      display_technology: String(body.display_technology || "").trim() || null,
      origin_type: String(body.origin_type || "").trim() || null,
      quality: normalized.quality || null, color: normalized.color || null, packaging: normalized.packaging || null,
      description_zh: normalized.description_zh || null, description_en: normalized.description_en || null,
      aliases: normalized.aliases, unit: normalized.unit, minimum_order_quantity: normalized.minimum_order_quantity,
      is_active: body.is_active !== false, updated_by: user.id, updated_at: new Date().toISOString(),
      category_id: body.category_id || null, image_url: String(body.image_url || "").trim() || null,
      supplier_identifier: String(body.supplier_identifier || "").trim() || null,
      supplier_code: String(body.supplier_code || "").trim() || null,
      supplier_source: String(body.supplier_source || "").trim() || null,
      specifications: checkedSpecs.specifications,
    }).eq("id", id).select("*").single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "PRODUCT_UPDATE", "product", id, { sku: data.sku, is_active: data.is_active });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
