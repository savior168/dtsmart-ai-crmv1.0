import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNormalizedProduct } from "@/lib/product-import";
import { activeTier, completeCostCny, type PriceTier } from "@/lib/product-pricing";

export async function GET(request: Request) {
  try {
    const { account } = await requirePermission("products.view");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("page_size")) || 20));
    const query = (url.searchParams.get("q") || "").trim();
    const active = url.searchParams.get("active") || "true";
    const admin = createAdminClient();
    let builder = admin.from("products").select("*,category:product_categories(id,code,name_zh,name_en),prices:product_prices(id,price_kind,currency,amount,minimum_quantity,effective_from,effective_to,is_active,source_note)", { count: "exact" });
    if (active === "true") builder = builder.eq("is_active", true);
    if (active === "false") builder = builder.eq("is_active", false);
    if (query) builder = builder.or(`sku.ilike.%${query.replace(/[%_,()]/g, "") }%,name_zh.ilike.%${query.replace(/[%_,()]/g, "") }%,name_en.ilike.%${query.replace(/[%_,()]/g, "") }%,brand.ilike.%${query.replace(/[%_,()]/g, "") }%,model.ilike.%${query.replace(/[%_,()]/g, "") }%`);
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
    const categories = await admin.from("product_categories").select("id,code,name_zh,name_en").eq("is_active", true).order("sort_order").order("name_zh");
    if (categories.error) throw categories.error;
    return NextResponse.json({ data: rows, categories: categories.data || [], count: count || 0, page, page_size: pageSize, can_view_cost: canViewCost, can_view_cost_total: canViewCostTotal, can_view_sales: canViewSales, can_manage: hasPermission(account, "products.manage") });
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
    const admin = createAdminClient();
    const payload = {
      name_zh: normalized.name_zh, name_en: normalized.name_en,
      brand: normalized.brand, model: normalized.model, part_type: normalized.part_type,
      quality: normalized.quality, color: normalized.color, packaging: normalized.packaging,
      description_zh: normalized.description_zh, description_en: normalized.description_en,
      aliases: normalized.aliases, unit: normalized.unit,
      minimum_order_quantity: normalized.minimum_order_quantity, created_by: user.id, updated_by: user.id,
      category_id: body.category_id || null, image_url: String(body.image_url || "").trim() || null,
      supplier_code: String(body.supplier_code || normalized.sku || "").trim() || null,
      supplier_source: String(body.supplier_source || "").trim() || null,
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
