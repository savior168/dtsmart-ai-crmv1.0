import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseProductPriceImport } from "@/lib/product-price-import";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("pricebooks.import");
    const admin = createAdminClient();
    const { data, error } = await admin.from("product_price_import_batches")
      .select("id,file_name,status,created_at,published_at,row_count")
      .order("created_at", { ascending: false }).limit(30);
    if (error) throw error;
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "调价批次读取失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, account } = await requirePermission("pricebooks.import");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size <= 0 || file.size > 2 * 1024 * 1024)
      return NextResponse.json({ error: "请选择不超过 2MB 的 .xlsx 价格更新模板" }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseProductPriceImport(buffer);
    if (parsed.some((row) => row.price_kind === "SALE_REFERENCE") && !hasPermission(account, "pricebooks.sales.view"))
      return NextResponse.json({ error: "无销售参考价查看权限" }, { status: 403 });
    if (parsed.some((row) => row.price_kind !== "SALE_REFERENCE") && !hasPermission(account, "pricebooks.cost.view"))
      return NextResponse.json({ error: "无采购成本查看权限" }, { status: 403 });
    const hash = createHash("sha256").update(buffer).digest("hex");
    const admin = createAdminClient();
    const bySku = new Map<string, { id: string; sku: string; name_zh: string; is_active: boolean }>();
    const skus = [...new Set(parsed.map((row) => row.sku))];
    for (let index = 0; index < skus.length; index += 80) {
      const { data, error } = await admin.from("products").select("id,sku,name_zh,is_active").in("sku", skus.slice(index, index + 80));
      if (error) throw error;
      for (const item of data || []) bySku.set(item.sku, item);
    }
    const productIds = [...new Set([...bySku.values()].map((item) => item.id))];
    const byPriceKey = new Map<string, Array<{ id: string; amount: number; effective_from: string }>>();
    for (let index = 0; index < productIds.length; index += 50) {
      const { data, count, error } = await admin.from("product_prices")
        .select("id,product_id,price_kind,currency,minimum_quantity,amount,effective_from", { count: "exact" })
        .in("product_id", productIds.slice(index, index + 50)).eq("is_active", true).range(0, 999);
      if (error) throw error;
      if ((count || 0) > (data || []).length) throw new Error("商品当前价格阶梯过多，无法完整核对；请缩小导入批次");
      for (const item of data || []) {
        const key = `${item.product_id}:${item.price_kind}:${item.currency}:${Number(item.minimum_quantity)}`;
        byPriceKey.set(key, [...(byPriceKey.get(key) || []), { id: item.id, amount: Number(item.amount), effective_from: item.effective_from }]);
      }
    }
    const rows = parsed.map((row) => {
      const product = bySku.get(row.sku);
      const matches = product ? byPriceKey.get(`${product.id}:${row.price_kind}:${row.currency}:${row.minimum_quantity}`) || [] : [];
      const issues = [
        ...(!product ? ["系统 SKU 未匹配任何商品"] : !product.is_active ? ["商品已停用"] : []),
        ...(matches.length > 1 ? ["相同价格阶梯存在多个当前版本，请先人工核对"] : []),
        ...(matches.length === 1 && row.effective_from < matches[0].effective_from ? ["生效日期早于当前价格版本，禁止倒填"] : []),
      ];
      return { ...row, product_id: product?.id || null, product_name: product?.name_zh || null,
        expected_price_id: matches.length === 1 ? matches[0].id : null,
        expected_amount: matches.length === 1 ? matches[0].amount : null, issues };
    });
    const { data, error } = await admin.from("product_price_import_batches")
      .insert({ file_sha256: hash, file_name: file.name.slice(0, 255), rows, row_count: rows.length, created_by: user.id })
      .select("id").single();
    if (error) throw error;
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "价格更新预览失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
