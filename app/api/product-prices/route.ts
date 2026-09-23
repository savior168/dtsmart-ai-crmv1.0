import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const { account } = await requirePermission("pricebooks.view");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("page_size")) || 20));
    const query = (url.searchParams.get("q") || "").trim().replace(/[%_,()]/g, "");
    const canViewCost = hasPermission(account, "pricebooks.cost.view");
    const canViewSales = hasPermission(account, "pricebooks.sales.view");
    const includeHistory = url.searchParams.get("history") === "true";
    const admin = createAdminClient();
    let productIds: string[] | null = null;
    if (query) {
      const { data: matching } = await admin.from("products").select("id").or(`sku.ilike.%${query}%,supplier_identifier.ilike.%${query}%,supplier_code.ilike.%${query}%,name_zh.ilike.%${query}%,name_en.ilike.%${query}%,brand.ilike.%${query}%,model.ilike.%${query}%`).limit(500);
      productIds = (matching || []).map((row) => row.id);
      if (!productIds.length) return NextResponse.json({ data: [], count: 0, page, page_size: pageSize, can_view_cost: canViewCost, can_view_sales: canViewSales, can_manage: hasPermission(account, "pricebooks.manage"), can_import: hasPermission(account, "pricebooks.import") });
    }
    let builder = admin.from("product_prices").select("*,product:products(id,sku,name_zh,name_en,brand,model,quality,unit,is_active)", { count: "exact" });
    if (!includeHistory) builder = builder.eq("is_active", true);
    const requestedKind = url.searchParams.get("kind");
    const allowedKinds = [...(canViewCost ? ["PROCUREMENT", "PACKAGING", "OTHER_COST"] : []), ...(canViewSales ? ["SALE_REFERENCE"] : [])];
    if (!allowedKinds.length) return NextResponse.json({ data: [], count: 0, page, page_size: pageSize, can_view_cost: false, can_view_sales: false, can_manage: false, can_import: false });
    builder = builder.in("price_kind", allowedKinds);
    if (requestedKind && allowedKinds.includes(requestedKind)) builder = builder.eq("price_kind", requestedKind);
    if (productIds) builder = builder.in("product_id", productIds);
    const { data, count, error } = await builder.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    return NextResponse.json({ data: data || [], count: count || 0, page, page_size: pageSize, can_view_cost: canViewCost, can_view_sales: canViewSales, can_manage: hasPermission(account, "pricebooks.manage"), can_import: hasPermission(account, "pricebooks.import") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "产品价格加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await requirePermission("pricebooks.manage");
    const body = await request.json();
    const productId = String(body.product_id || "");
    const supportedKinds = new Set(["PROCUREMENT", "PACKAGING", "OTHER_COST", "SALE_REFERENCE"]);
    const priceKind = String(body.price_kind || "");
    if (!supportedKinds.has(priceKind)) return NextResponse.json({ error: "请选择有效的价格项目" }, { status: 400 });
    const currency = priceKind === "SALE_REFERENCE" ? "USD" : "CNY";
    const amountText = String(body.amount ?? "").trim();
    const quantityText = String(body.minimum_quantity ?? "").trim();
    if (!/^\d+(?:\.\d{1,4})?$/.test(amountText)) return NextResponse.json({ error: "请明确填写非负价格，最多四位小数" }, { status: 400 });
    if (!/^\d+(?:\.\d{1,3})?$/.test(quantityText)) return NextResponse.json({ error: "请明确填写正数起订量，最多三位小数" }, { status: 400 });
    const amount = Number(body.amount);
    const minimumQuantity = Number(body.minimum_quantity);
    if (!productId || !Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: "商品与有效价格为必填项" }, { status: 400 });
    if (!Number.isFinite(minimumQuantity) || minimumQuantity <= 0) return NextResponse.json({ error: "起订量必须大于0" }, { status: 400 });
    const { data, error } = await supabase.rpc("save_product_price", { p_product_id: productId, p_price_kind: priceKind, p_currency: currency, p_amount: amount, p_minimum_quantity: minimumQuantity, p_effective_from: body.effective_from || new Date().toISOString().slice(0, 10), p_source_note: String(body.source_note || "手工维护").slice(0, 500) });
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "产品价格保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
