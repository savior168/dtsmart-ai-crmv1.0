import { QUOTE_CURRENCY_CODES } from "@/lib/currencies";
import { validPiMoney, validPiQuantity, validPiSellingPrice } from "@/lib/pi-line-values";
import { linkedPiUnitPrices } from "@/lib/pi-line-currency";
import type { createClient } from "@/lib/supabase/server";
import type { PiFeeInput, PiFeesInput } from "@/lib/pi-fees";
import { normalizeManualPhone } from "@/lib/contacts/manual-phone";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export function parsePiOrderInput(body: Record<string, unknown>) {
  const currency = String(body.currency || "").trim().toUpperCase();
  const rate = Number(body.fx_rate_cny_to_payment);
  const shipping = Number(body.shipping_cny ?? 0);
  if (!QUOTE_CURRENCY_CODES.has(currency)) throw new Error("请选择有效的客户付款币种");
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100000000 || Math.abs(rate - Math.round(rate * 1e12) / 1e12) > 1e-12) throw new Error("请输入有效汇率");
  // Comparing money * 100 with an integer rejects valid amounts such as
  // 322.34 because binary floating point stores 322.34 * 100 as 32233.999… .
  if (!validPiMoney(body.shipping_cny ?? 0)) throw new Error("人民币运费不正确");
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 500) throw new Error("请填写1至500条产品明细");
  const items = body.items.map((raw) => {
    const row = raw as Record<string, unknown>;
    const quantity = Number(row.quantity);
    const unitPriceCny = Number(row.unit_price_cny);
    const priceSource = row.unit_price_source ?? "CNY";
    const unitPricePayment = row.unit_price_payment === undefined
      ? Number(linkedPiUnitPrices(String(row.unit_price_cny), "CNY", rate).payment)
      : Number(row.unit_price_payment);
    const estimatedCostCny = Number(row.estimated_unit_cost_cny);
    if (![row.item_name, row.brand, row.model, row.quality].every((value) => String(value || "").trim()) || !validPiQuantity(row.quantity) || !validPiMoney(row.unit_price_cny) || !validPiMoney(unitPricePayment) || !validPiMoney(row.estimated_unit_cost_cny)) {
      throw new Error("每条产品都需填写产品、品牌、型号、质量、正整数数量，以及最多两位小数的非负人民币成本和售价");
    }
    if (priceSource !== "CNY" && priceSource !== "PAYMENT") throw new Error("产品销售单价的录入币种不正确");
    const expected = Number(priceSource === "CNY"
      ? linkedPiUnitPrices(String(row.unit_price_cny), "CNY", rate).payment
      : linkedPiUnitPrices(String(unitPricePayment), "PAYMENT", rate).cny);
    const supplied = priceSource === "CNY" ? unitPricePayment : unitPriceCny;
    if (Math.abs(expected - supplied) > 0.001) throw new Error("人民币与外币单价换算不一致，请核对汇率后重试");
    if (!validPiSellingPrice(row.unit_price_cny, row.estimated_unit_cost_cny)) throw new Error("每条产品的人民币售价必须高于成本价，请核对后再保存");
    return {
      item_name: String(row.item_name).trim().slice(0, 160),
      brand: String(row.brand || "").trim().slice(0, 120),
      model: String(row.model || "").trim().slice(0, 160),
      quality: String(row.quality || "").trim().slice(0, 160),
      description: String(row.description || "").trim().slice(0, 1000),
      description_zh: String(row.description_zh || "").trim().slice(0, 1000),
      quantity, unit_price_cny: unitPriceCny, unit_price_payment: unitPricePayment, unit_price_source: priceSource,
      estimated_unit_cost_cny: estimatedCostCny,
      preparation_requirement: String(row.preparation_requirement || "").trim().slice(0, 1000),
      internal_note: String(row.internal_note || "").trim().slice(0, 1000),
    };
  });
  const customerId = String(body.customer_id || "").trim();
  const warehouseReferenceNumber = String(body.warehouse_reference_number || "").trim();
  const paymentAccountId = String(body.payment_account_id || "").trim();
  if (!customerId || !paymentAccountId) throw new Error("请选择客户和收款账户");
  if (!warehouseReferenceNumber || warehouseReferenceNumber.length > 80) throw new Error("请填写80字以内的订单编号");
  const deliveryFields = [body.delivery_recipient, body.delivery_phone, body.delivery_email, body.delivery_address];
  if (deliveryFields.some((value) => value !== undefined && typeof value !== "string")) throw new Error("收货信息格式不正确");
  const [deliveryRecipient, deliveryPhone, deliveryEmail, deliveryAddress] = deliveryFields.map((value) => String(value || "").trim());
  const hasDelivery = deliveryFields.some((value) => String(value || "").trim());
  if (hasDelivery && (!deliveryRecipient || !deliveryPhone || !deliveryAddress)) throw new Error("添加客户收货信息后，收货人、电话和收货地址均为必填项");
  if (deliveryRecipient.trim().length > 200 || deliveryPhone.trim().length > 100 || deliveryEmail.trim().length > 200 || deliveryAddress.trim().length > 1000) {
    throw new Error("收货信息超出允许长度，请核对后重试");
  }
  if (deliveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(deliveryEmail)) throw new Error("请输入有效的收货邮箱地址");
  const normalizedDeliveryPhone = hasDelivery ? normalizeManualPhone(deliveryPhone, "收货人电话") : "";
  const phoneDigits = normalizedDeliveryPhone.replace(/\D/g, "");
  if (hasDelivery && (phoneDigits.length < 7 || phoneDigits.length > 15 || /^(\d)\1+$/.test(phoneDigits))) throw new Error("收货人电话须为有效的 7 至 15 位号码");
  const forwarderFields = [body.forwarder_recipient, body.forwarder_phone, body.forwarder_address];
  if (forwarderFields.some((value) => value !== undefined && typeof value !== "string")) throw new Error("货代收货信息格式不正确");
  const [forwarderRecipient, forwarderPhone, forwarderAddress] = forwarderFields.map((value) => String(value || "").trim());
  const hasForwarder = forwarderFields.some((value) => String(value || "").trim());
  if (hasForwarder && (!forwarderRecipient || !forwarderPhone || !forwarderAddress)) throw new Error("添加货代收货信息后，收货人、电话和收货地址均为必填项");
  if (forwarderRecipient.length > 200 || forwarderPhone.length > 100 || forwarderAddress.length > 500) throw new Error("货代收货信息超出允许长度");
  const normalizedForwarderPhone = hasForwarder ? normalizeManualPhone(forwarderPhone, "货代收货人电话") : "";
  const forwarderPhoneDigits = normalizedForwarderPhone.replace(/\D/g, "");
  if (hasForwarder && (forwarderPhoneDigits.length < 7 || forwarderPhoneDigits.length > 15 || /^(\d)\1+$/.test(forwarderPhoneDigits))) throw new Error("货代收货人电话须为有效的 7 至 15 位号码");
  const fees = parsePiFees(body.fees, String(body.payment_method || ""));
  if (fees.shipping && Math.abs(Number(linkedPiUnitPrices(fees.shipping.amount.toFixed(2), fees.shipping.source, rate).cny) - shipping) > 0.001) {
    throw new Error("运费双币种换算不一致，请核对汇率后重试");
  }
  return {
    p_customer_id: customerId,
    p_warehouse_reference_number: warehouseReferenceNumber,
    p_currency: currency,
    p_fx_rate: rate,
    p_shipping_cny: shipping,
    p_payment_method: String(body.payment_method || "").trim().slice(0, 300) || null,
    p_payment_account_id: paymentAccountId,
    p_valid_until: String(body.valid_until || "").trim() || null,
    p_delivery_date: String(body.delivery_date || "").trim() || null,
    p_delivery_recipient: deliveryRecipient.trim(),
    p_delivery_phone: normalizedDeliveryPhone,
    p_delivery_email: deliveryEmail.trim(),
    p_delivery_address: deliveryAddress.trim(),
    p_stocking_requirements: String(body.stocking_requirements || "").trim().slice(0, 2000) || "常规理货",
    p_items: items,
    p_fees: { ...fees, forwarder_address: forwarderAddress, forwarder_recipient: forwarderRecipient, forwarder_phone: normalizedForwarderPhone },
  };
}

function parsePiFees(value: unknown, paymentMethod: string): PiFeesInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请核对PI附加费用");
  const fees = value as Record<string, unknown>;
  if (fees.show_dual_currency_prices !== undefined && typeof fees.show_dual_currency_prices !== "boolean") throw new Error("PI双币种展示选项不正确");
  if (fees.price_display_mode !== undefined && !["PAYMENT_ONLY", "CNY_ONLY", "DUAL"].includes(String(fees.price_display_mode))) throw new Error("PI报价展示方式不正确");
  const parseCharge = (key: string): PiFeeInput => {
    const raw = fees[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("请核对PI附加费用");
    const charge = raw as Record<string, unknown>;
    const amount = Number(charge.amount);
    if ((charge.source !== "CNY" && charge.source !== "PAYMENT") ||
        !Number.isFinite(amount) || amount < 0 || amount > 999999999999 ||
        !/^\d+(?:\.\d{1,2})?$/.test(String(charge.amount))) {
      throw new Error("附加费用须为非负且最多两位小数的金额");
    }
    return { source: charge.source, amount };
  };
  const rate = Number(fees.paypal_rate_percent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || !/^\d+(?:\.\d{1,4})?$/.test(String(fees.paypal_rate_percent))) {
    throw new Error("PayPal手续费百分比须在0%至100%之间，最多四位小数");
  }
  return {
    shipping: fees.shipping === undefined ? undefined : parseCharge("shipping"),
    last_balance: parseCharge("last_balance"),
    discount: parseCharge("discount"),
    other: parseCharge("other"),
    paypal_rate_percent: paymentMethod === "PayPal" ? rate : 0,
    show_dual_currency_prices: fees.show_dual_currency_prices === true,
    price_display_mode: fees.price_display_mode as PiFeesInput["price_display_mode"],
  };
}

export async function requireOwnedPiCustomer(supabase: ServerSupabase, accountId: string, customerId: string) {
  const { data, error } = await supabase.from("customers").select("id")
    .eq("id", customerId).eq("owner_id", accountId).is("deleted_at", null).neq("status", "RELEASED").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("只能为归属自己的有效客户创建PI订单");
}

