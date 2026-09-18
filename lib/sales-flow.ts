import type { QuoteItem, QuoteStatus, StockOrderStatus } from "@/lib/types";
import { QUOTE_CURRENCY_CODES } from "@/lib/currencies";

export const QUOTE_EDITABLE_STATUSES: QuoteStatus[] = ["DRAFT", "GENERATED"];
export const STOCK_TERMINAL_STATUSES: StockOrderStatus[] = ["READY", "CANCELLED"];
export const STOCK_TRANSITIONS: Record<StockOrderStatus, StockOrderStatus[]> = {
  DRAFT: ["WAITING", "CANCELLED"],
  WAITING: ["PREPARING", "SHORTAGE", "CANCELLED"],
  PREPARING: ["READY", "SHORTAGE", "CANCELLED"],
  SHORTAGE: ["PREPARING", "CANCELLED"],
  READY: [], CANCELLED: [],
};

function text(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function nonNegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : -1;
}

function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

export function normalizeQuoteItems(value: unknown): QuoteItem[] {
  if (!Array.isArray(value)) throw new Error("请至少添加一条产品明细");
  const rows = value.map((raw, index) => {
    const item = (raw || {}) as Record<string, unknown>;
    const normalized: QuoteItem = {
      line_number: index + 1,
      item_name: text(item.item_name, 160),
      brand: text(item.brand, 120),
      model: text(item.model, 160),
      quality: text(item.quality, 160),
      description: text(item.description, 1000),
      description_zh: null,
      quantity: positive(item.quantity),
      unit_price: nonNegative(item.unit_price),
      procurement_cost: 0,
      preparation_requirement: null,
    };
    if (!normalized.item_name) throw new Error(`第 ${index + 1} 行缺少产品名称`);
    if (normalized.quantity <= 0 || !Number.isInteger(normalized.quantity)) throw new Error(`第 ${index + 1} 行数量必须为大于0的整数`);
    if (normalized.unit_price < 0) throw new Error(`第 ${index + 1} 行销售单价不正确`);
    return normalized;
  });
  if (!rows.length) throw new Error("请至少添加一条产品明细");
  if (rows.length > 500) throw new Error("单张报价单最多500条产品明细");
  return rows;
}

export function quoteTotals(items: QuoteItem[], shippingCost: unknown) {
  const shipping = Math.max(0, nonNegative(shippingCost));
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0) * 100) / 100;
  const procurement = Math.round(items.reduce((sum, item) => sum + item.quantity * item.procurement_cost, 0) * 100) / 100;
  return { subtotal, shipping, total: Math.round((subtotal + shipping) * 100) / 100, procurement };
}

export function cleanQuotePayload(body: Record<string, unknown>) {
  const items = normalizeQuoteItems(body.items);
  const shippingCost = nonNegative(body.shipping_cost);
  if (shippingCost < 0) throw new Error("运费不正确");
  const currency = text(body.currency, 8).toUpperCase() || "USD";
  if (!QUOTE_CURRENCY_CODES.has(currency)) throw new Error("请选择系统支持的报价币种");
  return {
    items,
    customer_id: text(body.customer_id, 80),
    currency,
    valid_until: text(body.valid_until, 10) || null,
    payment_method: text(body.payment_method, 300) || null,
    delivery_date: text(body.delivery_date, 10) || null,
    customer_short_name: text(body.customer_short_name, 200) || null,
    destination_country: text(body.destination_country, 100) || null,
    stocking_requirements: null,
    shipping_cost: shippingCost,
    notes: text(body.notes, 3000) || null,
  };
}

export function sqlErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message || "");
    if (message) return message.replace(/^.*?:\s*/, "");
  }
  return fallback;
}
