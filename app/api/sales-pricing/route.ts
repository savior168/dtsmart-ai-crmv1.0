import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { account } = await requirePermission("pricebooks.rules.view");
    const admin = createAdminClient();
    const [settings,rules,categories,products] = await Promise.all([
      admin.from("sales_pricing_settings").select("*").eq("id",true).single(),
      admin.from("sales_pricing_rules").select("*,category:product_categories(id,code,name_zh),product:products(id,sku,name_zh,brand,model)").eq("is_active",true).order("updated_at",{ascending:false}),
      admin.from("product_categories").select("id,code,name_zh").eq("is_active",true).order("sort_order").order("name_zh"),
      admin.from("products").select("id,sku,name_zh,brand,model").eq("is_active",true).order("updated_at",{ascending:false}).limit(500),
    ]);
    for (const result of [settings,rules,categories,products]) if (result.error) throw result.error;
    return NextResponse.json({settings:settings.data,rules:rules.data||[],categories:categories.data||[],products:products.data||[],can_manage:hasPermission(account,"pricebooks.rules.manage")});
  } catch (error) {
    const message=error instanceof Error?error.message:"销售报价设置加载失败";
    return NextResponse.json({error:message},{status:authErrorStatus(message)||500});
  }
}

export async function POST(request:Request) {
  try {
    const { supabase } = await requirePermission("pricebooks.rules.manage");
    const body=await request.json();
    if(body.type==="SETTINGS"){
      const values={
        cny_per_usd:Number(body.cny_per_usd),default_markup_percent:Number(body.default_markup_percent),
        minimum_margin_percent:Number(body.minimum_margin_percent),rounding_increment:Number(body.rounding_increment),
        quote_valid_days:Number(body.quote_valid_days),source_note:String(body.source_note||"").trim(),
      };
      if(values.cny_per_usd<=0||values.default_markup_percent<0||values.minimum_margin_percent<0||values.minimum_margin_percent>=100||values.rounding_increment<=0||values.quote_valid_days<1||!values.source_note)return NextResponse.json({error:"请填写有效汇率、加价、毛利、取整、有效期和来源说明"},{status:400});
      const {data,error}=await supabase.rpc("save_sales_pricing_settings",{p_cny_per_usd:values.cny_per_usd,p_default_markup_percent:values.default_markup_percent,p_minimum_margin_percent:values.minimum_margin_percent,p_rounding_increment:values.rounding_increment,p_quote_valid_days:values.quote_valid_days,p_source_note:values.source_note});
      if(error)throw error;return NextResponse.json({data});
    }
    const categoryId=body.scope_type==="CATEGORY"?String(body.scope_id||""):null;
    const productId=body.scope_type==="PRODUCT"?String(body.scope_id||""):null;
    if(!categoryId&&!productId)return NextResponse.json({error:"请选择规则适用的商品或分类"},{status:400});
    const {data,error}=await supabase.rpc("save_sales_pricing_rule",{p_category_id:categoryId,p_product_id:productId,p_markup_percent:Number(body.markup_percent),p_minimum_margin_percent:Number(body.minimum_margin_percent),p_rounding_increment:Number(body.rounding_increment)});
    if(error)throw error;return NextResponse.json({data},{status:201});
  }catch(error){const message=error instanceof Error?error.message:"销售报价设置保存失败";return NextResponse.json({error:message},{status:authErrorStatus(message)||500})}
}
