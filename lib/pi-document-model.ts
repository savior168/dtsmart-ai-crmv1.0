export type PiDocumentOrder = {
  order_number: string;
  warehouse_reference_number?: string | null;
  created_at?: string | null;
  confirmed_at?: string | null;
  pi_valid_until?: string | null;
  delivery_date?: string | null;
  payment_method?: string | null;
  currency: string;
  show_dual_currency_prices?: boolean | null;
  price_display_mode?: "PAYMENT_ONLY" | "CNY_ONLY" | "DUAL" | null;
  customer_short_name: string;
  customer_tax_number_snapshot?: string | null;
  customer?: { company_name?: string | null; contact_name?: string | null; tax_number?: string | null } | null;
  seller_company_name?: string | null;
  seller_company_address?: string | null;
  seller_website?: string | null;
  seller_contact_name?: string | null;
  seller_contact_phone?: string | null;
  seller_contact_email?: string | null;
  delivery_recipient?: string | null;
  delivery_phone?: string | null;
  delivery_email?: string | null;
  delivery_address?: string | null;
  subtotal: number;
  subtotal_cny?: number | null;
  shipping_cost: number;
  shipping_cny?: number | null;
  total_amount: number;
  total_cny?: number | null;
  last_balance_amount?: number | null;
  last_balance_cny?: number | null;
  discount_amount?: number | null;
  discount_cny?: number | null;
  other_charge_amount?: number | null;
  other_charge_cny?: number | null;
  paypal_fee_percent?: number | null;
  paypal_fee_amount?: number | null;
  paypal_fee_cny?: number | null;
};

export type PiDocumentItem = {
  line_number: number;
  item_name: string;
  brand?: string | null;
  model?: string | null;
  quality?: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  unit_price_cny?: number | null;
};

export const DEFAULT_OFFICIAL_WEBSITE = "https://www.dt-smart.com/";

export function piDateLabel(value?: string | null) {
  return value?.slice(0, 10) || "—";
}

/** Shared customer-facing values for the browser preview and Excel export. */
export function createPiDocumentModel(order: PiDocumentOrder, items: PiDocumentItem[]) {
  const issueDate = piDateLabel(order.created_at || order.confirmed_at);
  return {
    orderNumber: order.warehouse_reference_number || order.order_number,
    companyName: order.seller_company_name || "DT-Smart Technology Co., Ltd",
    companyAddress: order.seller_company_address || "—",
    website: order.seller_website || DEFAULT_OFFICIAL_WEBSITE,
    salesManager: order.seller_contact_name || "—",
    contactPhone: order.seller_contact_phone || "—",
    contactEmail: order.seller_contact_email || "—",
    quotationValidUntil: piDateLabel(order.pi_valid_until),
    deliveryDate: piDateLabel(order.delivery_date),
    paymentMethod: `${order.payment_method || "—"} (${order.currency})`,
    recipient: order.delivery_recipient?.trim() || "",
    deliveryPhone: order.delivery_phone || "—",
    deliveryCompany: order.customer_short_name || "",
    deliveryTaxNumber: order.customer_tax_number_snapshot?.trim() || "",
    deliveryEmail: order.delivery_email || "—",
    deliveryAddress: order.delivery_address || "—",
    issueDate,
    currency: order.currency,
    showDualCurrencyPrices: (order.price_display_mode === "DUAL" || (!order.price_display_mode && order.show_dual_currency_prices === true)) && order.currency !== "CNY",
    priceDisplayMode: order.price_display_mode || (order.show_dual_currency_prices ? "DUAL" : "PAYMENT_ONLY"),
    subtotal: Number(order.subtotal),
    subtotalCny: Number(order.subtotal_cny || 0),
    shippingCost: Number(order.shipping_cost),
    shippingCostCny: Number(order.shipping_cny || 0),
    lastBalance: Number(order.last_balance_amount || 0),
    lastBalanceCny: Number(order.last_balance_cny || 0),
    discount: Number(order.discount_amount || 0),
    discountCny: Number(order.discount_cny || 0),
    otherCharge: Number(order.other_charge_amount || 0),
    otherChargeCny: Number(order.other_charge_cny || 0),
    paypalFeePercent: Number(order.paypal_fee_percent || 0),
    paypalFee: Number(order.paypal_fee_amount || 0),
    paypalFeeCny: Number(order.paypal_fee_cny || 0),
    totalAmount: Number(order.total_amount),
    totalAmountCny: Number(order.total_cny || 0),
    totalQuantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    items: items.map((item, index) => ({
      lineNumber: index + 1,
      itemName: item.item_name,
      brand: item.brand || "",
      model: item.model || "",
      quality: item.quality || "",
      description: item.description || "",
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      unitPriceCny: Number(item.unit_price_cny ?? 0),
      amount: Math.round((Number(item.unit_price) * Number(item.quantity) + Number.EPSILON) * 100) / 100,
      amountCny: Math.round((Number(item.unit_price_cny ?? 0) * Number(item.quantity) + Number.EPSILON) * 100) / 100,
    })),
  };
}
