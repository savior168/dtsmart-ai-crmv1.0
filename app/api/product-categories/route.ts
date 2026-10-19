import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProductFamily } from "@/lib/product-specifications";

export async function GET(request: Request) {
  try {
    const { account } = await requirePermission("products.categories.view");
    const url = new URL(request.url);
    let query = createAdminClient().from("product_categories").select("id,code,name_zh,name_en,parent_id,sort_order,is_active,product_family");
    if (url.searchParams.get("active") !== "all") query = query.eq("is_active", true);
    const { data, error } = await query.order("sort_order").order("name_zh");
    if (error) throw error;
    return NextResponse.json({ data: data || [], can_manage: hasPermission(account, "products.categories.manage") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品分类加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requirePermission("products.categories.manage");
    const body = await request.json();
    const name = String(body.name_zh || "").trim();
    if (!name) return NextResponse.json({ error: "中文名称为必填项" }, { status: 400 });
    if (!isProductFamily(body.product_family)) return NextResponse.json({ error: "请选择有效的商品规格类型" }, { status: 400 });
    const { data, error } = await createAdminClient().from("product_categories").insert({ name_zh: name, name_en: String(body.name_en || "").trim() || null, product_family: body.product_family, sort_order: Number(body.sort_order) || 0, created_by: user.id }).select("*").single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "PRODUCT_CATEGORY_CREATE", "product_category", data.id, { code: data.code, name_zh: name });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品分类创建失败";
    return NextResponse.json({ error: message }, { status: message.includes("duplicate") ? 409 : authErrorStatus(message) || 500 });
  }
}
