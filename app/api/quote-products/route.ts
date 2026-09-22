import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeTier, completeCostCny, suggestedUsdPrice, type PriceTier, type PricingRule } from "@/lib/product-pricing";

export async function GET(request:Request){
  try{
    const {account}=await requirePermission("quotes.create");
    if(!hasPermission(account,"products.view"))return NextResponse.json({error:"无商品资料查看权限"},{status:403});
    const url=new URL(request.url);const search=(url.searchParams.get("q")||"").trim().replace(/[%_,()]/g,"");const quantity=Math.max(1,Number(url.searchParams.get("quantity"))||1);
    const admin=createAdminClient();
    let query=admin.from("products").select("id,sku,supplier_code,category_id,name_zh,name_en,brand,model,quality,description_en,unit,minimum_order_quantity,aliases,prices:product_prices(price_kind,currency,amount,minimum_quantity,effective_from,is_active)").eq("is_active",true);
    if(search)query=query.or(`sku.ilike.%${search}%,supplier_code.ilike.%${search}%,name_zh.ilike.%${search}%,name_en.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%`);
    const [products,settings,rules]=await Promise.all([query.order("updated_at",{ascending:false}).limit(40),admin.from("sales_pricing_settings").select("*").eq("id",true).single(),admin.from("sales_pricing_rules").select("*").eq("is_active",true)]);
    if(products.error)throw products.error;if(settings.error)throw settings.error;if(rules.error)throw rules.error;
    const defaultRule:PricingRule={markup_percent:Number(settings.data.default_markup_percent),minimum_margin_percent:Number(settings.data.minimum_margin_percent),rounding_increment:Number(settings.data.rounding_increment)};
    const data=(products.data||[]).map(product=>{const prices=(product.prices||[]) as PriceTier[];const requestedQuantity=Math.max(quantity,Number(product.minimum_order_quantity)||1);const cost=completeCostCny(prices,requestedQuantity);const productRule=rules.data?.find(rule=>rule.product_id===product.id);const categoryRule=rules.data?.find(rule=>!rule.product_id&&rule.category_id===product.category_id);const selected=productRule||categoryRule;const rule:PricingRule=selected?{markup_percent:Number(selected.markup_percent),minimum_margin_percent:Number(selected.minimum_margin_percent),rounding_increment:Number(selected.rounding_increment)}:defaultRule;const calculated=suggestedUsdPrice(cost,Number(settings.data.cny_per_usd),rule);const reference=Number(activeTier(prices,"SALE_REFERENCE",requestedQuantity)?.amount||0);return{...product,prices:undefined,total_cost_cny:cost,suggested_price_usd:Math.max(calculated,reference),sale_reference_usd:reference||null,exchange_rate:Number(settings.data.cny_per_usd),pricing_rule:{...rule,scope:productRule?"PRODUCT":categoryRule?"CATEGORY":"GLOBAL",rule_id:selected?.id||null,source_note:settings.data.source_note},quantity:requestedQuantity}});
    return NextResponse.json({data,quote_valid_days:Number(settings.data.quote_valid_days)});
  }catch(error){const message=error instanceof Error?error.message:"可报价商品加载失败";return NextResponse.json({error:message},{status:authErrorStatus(message)||500})}
}
