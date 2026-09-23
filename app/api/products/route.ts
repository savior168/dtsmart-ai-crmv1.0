import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNormalizedProduct } from "@/lib/product-import";
import { activeTier, completeCostCny, type PriceTier } from "@/lib/product-pricing";
import { isProductFamily, normalizeProductSpecifications, type ProductFamily } from "@/lib/product-specifications";

export async function GET(request: Request) {
  try {
    const { account } = await requirePermission("products.view");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("page_size")) || 20));
    const query = (url.searchParams.get("q") || "").trim();
    const active = url.searchParams.get("active") || "true";
    const category = url.searchParams.get("category") || "";
    const admin = createAdminClient();
    let builder = admin.from("products").select("*,category:product_categories(id,code,name_zh,name_en,product_family),prices:product_prices(id,price_kind,currency,amount,minimum_quantity,effective_from,effective_to,is_active,source_note)", { count: "exact" });
    if (active === "true") builder = builder.eq("is_active", true);
    if (active === "false") builder = builder.eq("is_active", false);
    if (category === "unclassified") builder = builder.is("category_id", null);
    else if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(category)) builder = builder.eq("category_id", category);
    if (query) {
      const safeQuery = query.replace(/[%_,()]/g, "");
      builder = builder.or(`sku.ilike.%${safeQuery}%,supplier_identifier.ilike.%${safeQuery}%,supplier_code.ilike.%${safeQuery}%,name_zh.ilike.%${safeQuery}%,name_en.ilike.%${safeQuery}%,brand.ilike.%${safeQuery}%,model.ilike.%${safeQuery}%,manufacturer_brand.ilike.%${safeQuery}%,display_technology.ilike.%${safeQuery}%,origin_type.ilike.%${safeQuery}%,part_type.ilike.%${safeQuery}%,quality.ilike.%${safeQuery}%`);
    }
    const { data, count, error } = await builder.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    const canViewCost = hasPermission(account, "pricebooks.cost.view");
    const canViewCostTotal = canViewCost || hasPermission(account, "pricebooks.cost.total.view");
    const canViewSales = hasPermission(account, "pricebooks.sales.view");
    const rows = (data || []).map((product) => ({
      ...product,
      total_cost_cny: canViewCostTotal ? completeCostCny((product.prices || []) as PriceTier[], Number(product.minimum_order_quantity) || 1) : null,
      sale_reference_usd: canViewSales ? activeTier((product.prices || []) as PriceTier[], "SALE_REFERENCE", Number(product.minimum_order_quantity) || 1)?.amount ?? null : null,
      prices: (product.prices || []).filter((price: { price_kind: string }) =>
        (["PROCUREMENT", "PACKAGING", "OTHER_COST"].includes(price.price_kind) && canViewCost)
        || (price.price_kind === "SALE_REFERENCE" && canViewSales)),
    }));
    const categories = await admin.from("product_categories").select("id,code,name_zh,name_en,is_active,product_family").order("sort_order").order("name_zh");
    if (categories.error) throw categories.error;
    return NextResponse.json({ data: rows, categories: categories.data || [], count: count || 0, page, page_size: pageSize, can_view_cost: canViewCost, can_view_cost_total: canViewCostTotal, can_view_sales: canViewSales, can_manage: hasPermission(account, "products.manage"), can_import: hasPermission(account, "pricebooks.import") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品资料加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requirePermission("products.manage");
    const body = await request.json();
    const { normalized, issues } = validateNormalizedProduct(body);
    if (issues.some((issue) => issue.includes("商品名称"))) return NextResponse.json({ error: issues.join("；") }, { status: 400 });
    if (!body.category_id) return NextResponse.json({ error: "请选择商品分类并核对对应规格" }, { status: 400 });
    if (body.minimum_order_quantity !== undefined && (!Number.isFinite(Number(body.minimum_order_quantity)) || Number(body.minimum_order_quantity) <= 0)) return NextResponse.json({ error: "最小起订量必须大于0" }, { status: 400 });
    const admin = createAdminClient();
    let family: ProductFamily = "OTHER";
    if (body.category_id) {
      const category = await admin.from("product_categories").select("product_family,is_active").eq("id", body.category_id).single();
      if (category.error || !category.data?.is_active || !isProductFamily(category.data.product_family)) return NextResponse.json({ error: "请选择有效且已启用的商品分类" }, { status: 400 });
      family = category.data.product_family;
    }
    const checkedSpecs = normalizeProductSpecifications(body.specifications, family);
    if (checkedSpecs.error) return NextResponse.json({ error: checkedSpecs.error }, { status: 400 });
    const payload = {
      name_zh: normalized.name_zh, name_en: normalized.name_en,
      brand: normalized.brand, model: normalized.model, part_type: normalized.part_type,
      manufacturer_brand: String(body.manufacturer_brand || "").trim() || null,
      display_technology: String(body.display_technology || "").trim() || null,
      origin_type: String(body.origin_type || "").trim() || null,
      quality: normalized.quality, color: normalized.color, packaging: normalized.packaging,
      description_zh: normalized.description_zh, description_en: normalized.description_en,
      aliases: normalized.aliases, unit: normalized.unit,
      minimum_order_quantity: normalized.minimum_order_quantity, created_by: user.id, updated_by: user.id,
      category_id: body.category_id || null, image_url: String(body.image_url || "").trim() || null,
      supplier_identifier: String(body.supplier_identifier || "").trim() || null,
      supplier_code: String(body.supplier_code || "").trim() || null,
      supplier_source: String(body.supplier_source || "").trim() || null,
      specifications: checkedSpecs.specifications,
    };
    const { data, error } = await admin.from("products").insert(payload).select("*").single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "PRODUCT_CREATE", "product", data.id, { sku: data.sku });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品创建失败";
    return NextResponse.json({ error: message }, { status: message.includes("duplicate") ? 409 : authErrorStatus(message) || 500 });
  }
}
