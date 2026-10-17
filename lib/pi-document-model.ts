export type PiDocumentOrder = {
  order_number: string;
  warehouse_reference_number?: string | null;
  created_at?: string | null;
  confirmed_at?: string | null;
  pi_valid_until?: string | null;
  delivery_date?: string | null;
  payment_method?: string | null;
  currency: string;
  customer_short_name: string;
  customer?: { company_name?: string | null; contact_name?: string | null } | null;
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
  shipping_cost: number;
  total_amount: number;
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
    recipient: order.customer?.contact_name?.trim() || "",
    deliveryPhone: order.delivery_phone || "—",
    deliveryCompany: order.customer?.company_name?.trim() || order.customer_short_name || "",
    deliveryEmail: order.delivery_email || "—",
    deliveryAddress: order.delivery_address || "—",
    issueDate,
    currency: order.currency,
    subtotal: Number(order.subtotal),
    shippingCost: Number(order.shipping_cost),
    totalAmount: Number(order.total_amount),
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
      amount: Math.round((Number(item.unit_price) * Number(item.quantity) + Number.EPSILON) * 100) / 100,
    })),
  };
}
