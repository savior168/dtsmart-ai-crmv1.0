import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { QUOTE_CURRENCY_CODES } from "@/lib/currencies";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { validPiMoney, validPiQuantity, validPiSellingPrice } from "@/lib/pi-line-values";

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.create");
    if (account.role !== "SALES" && account.role !== "SUPERVISOR" && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const body = await request.json() as Record<string, unknown>;
    const currency = String(body.currency || "").trim().toUpperCase();
    const rate = Number(body.fx_rate_cny_to_payment);
    const shipping = Number(body.shipping_cny ?? 0);
    if (!QUOTE_CURRENCY_CODES.has(currency)) throw new Error("请选择有效的客户付款币种");
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100000000 || Math.abs(rate - Math.round(rate * 1e12) / 1e12) > 1e-12) throw new Error("请输入有效汇率");
    if (!Number.isFinite(shipping) || shipping < 0 || Math.round(shipping * 100) !== shipping * 100) throw new Error("人民币运费不正确");
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 500) throw new Error("请填写1至500条产品明细");
    const items = body.items.map((raw) => {
      const row = raw as Record<string, unknown>;
      const quantity = Number(row.quantity);
      const unitPriceCny = Number(row.unit_price_cny);
      const estimatedCostCny = Number(row.estimated_unit_cost_cny);
      if (![row.item_name, row.brand, row.model, row.quality].every((value) => String(value || "").trim()) || !validPiQuantity(row.quantity) || !validPiMoney(row.unit_price_cny) || !validPiMoney(row.estimated_unit_cost_cny)) {
        throw new Error("每条产品都需填写产品、品牌、型号、质量、正整数数量，以及最多两位小数的非负人民币成本和售价");
      }
      if (!validPiSellingPrice(row.unit_price_cny, row.estimated_unit_cost_cny)) throw new Error("每条产品的人民币售价必须高于成本价，请核对后再保存");
      return {
        item_name: String(row.item_name).trim().slice(0, 160),
        brand: String(row.brand || "").trim().slice(0, 120),
        model: String(row.model || "").trim().slice(0, 160),
        quality: String(row.quality || "").trim().slice(0, 160),
        description: String(row.description || "").trim().slice(0, 1000),
        description_zh: (String(row.description_zh || "").trim() || [row.item_name, row.brand, row.model, row.quality].map((value) => String(value).trim()).join(" / ")).slice(0, 1000),
        quantity, unit_price_cny: unitPriceCny, estimated_unit_cost_cny: estimatedCostCny,
        preparation_requirement: String(row.preparation_requirement || "").trim().slice(0, 1000),
        internal_note: String(row.internal_note || "").trim().slice(0, 1000),
      };
    });
    const customerId = String(body.customer_id || "").trim();
    const warehouseReferenceNumber = String(body.warehouse_reference_number || "").trim();
    const paymentAccountId = String(body.payment_account_id || "").trim();
    if (!customerId || !paymentAccountId) throw new Error("请选择客户和收款账户");
    if (!warehouseReferenceNumber || warehouseReferenceNumber.length > 80) throw new Error("请填写80字以内的订单编号");
    const { data: ownedCustomer, error: customerError } = await supabase.from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("owner_id", account.id)
      .is("deleted_at", null)
      .neq("status", "RELEASED")
      .maybeSingle();
    if (customerError) throw customerError;
    if (!ownedCustomer) throw new Error("只能为归属自己的有效客户创建PI订单");
    const { data, error } = await supabase.rpc("create_direct_pi_order", {
      p_customer_id: customerId,
      p_warehouse_reference_number: warehouseReferenceNumber,
      p_currency: currency,
      p_fx_rate: rate,
      p_shipping_cny: shipping,
      p_payment_method: String(body.payment_method || "").trim().slice(0, 300) || null,
      p_payment_account_id: paymentAccountId,
      p_valid_until: String(body.valid_until || "").trim() || null,
      p_delivery_date: String(body.delivery_date || "").trim() || null,
      p_delivery_recipient: String(body.delivery_recipient || "").trim().slice(0, 200) || null,
      p_delivery_phone: String(body.delivery_phone || "").trim().slice(0, 100) || null,
      p_delivery_email: String(body.delivery_email || "").trim().slice(0, 200) || null,
      p_delivery_address: String(body.delivery_address || "").trim().slice(0, 1000) || null,
      p_stocking_requirements: String(body.stocking_requirements || "").trim().slice(0, 2000) || "常规理货",
      p_items: items,
    });
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI订单创建失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
