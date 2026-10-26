import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { parsePiOrderInput } = await jiti.import(resolve("lib/pi-order-input.ts"));
const fee = { source: "CNY", amount: 0 };
const base = {
  customer_id: "customer", payment_account_id: "account", warehouse_reference_number: "TEST-PI",
  valid_until: "2026-11-30",
  currency: "CNY", fx_rate_cny_to_payment: 1, shipping_cny: 0, payment_method: "T/T Bank Transfer",
  items: [{ item_name: "Display", brand: "Brand", model: "Model", quality: "New", quantity: 1,
    unit_price_cny: 100, unit_price_payment: 100, estimated_unit_cost_cny: 50 }],
  fees: { last_balance: fee, discount: fee, other: fee, paypal_rate_percent: 0 },
};

const empty = parsePiOrderInput(base);
assert.equal(empty.p_delivery_recipient, "");
assert.equal(empty.p_delivery_phone, "");
assert.equal(empty.p_delivery_email, "");
assert.equal(empty.p_delivery_address, "");
assert.equal(empty.p_fees.forwarder_address, "");
assert.equal(empty.p_fees.forwarder_recipient, "");

assert.throws(() => parsePiOrderInput({ ...base, delivery_recipient: "Alice" }), /收货人、电话和收货地址/);
assert.throws(() => parsePiOrderInput({ ...base, forwarder_address: "Warehouse" }), /收货人、电话和收货地址/);
const customer = parsePiOrderInput({ ...base, delivery_recipient: "Alice", delivery_phone: "+8613800138000", delivery_address: "Paris" });
assert.equal(customer.p_delivery_email, "", "收货邮箱不应是全渠道必填项");
assert.throws(() => parsePiOrderInput({ ...base, delivery_recipient: "Alice", delivery_phone: "+8613800138000", delivery_address: "Paris", delivery_email: "invalid" }), /有效的收货邮箱/);
const forwarder = parsePiOrderInput({ ...base, forwarder_recipient: "Bob", forwarder_phone: "+8613800138000", forwarder_address: "Warehouse" });
assert.equal(forwarder.p_fees.forwarder_recipient, "Bob");
assert.equal(forwarder.p_fees.forwarder_phone, "+8613800138000");
assert.equal(forwarder.p_fees.forwarder_address, "Warehouse");
console.log("PI optional customer and forwarder delivery validation passed.");
