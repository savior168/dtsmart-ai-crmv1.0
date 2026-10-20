import { normalizeManualPhone } from "@/lib/contacts/manual-phone";

export const MAX_CUSTOMER_ADDRESSES = 10;
export type ShippingContact = { address: string; recipient: string; phone: string };

export function displayShippingContacts(value: ShippingContact[] | null | undefined, addresses: string[]): ShippingContact[] {
  return addresses.map((address) => {
    const saved = Array.isArray(value) ? value.find((entry) => entry?.address === address) : null;
    return { address, recipient: saved?.recipient || "", phone: saved?.phone || "" };
  });
}

export function validateShippingContacts(value: unknown, label = "客户收货信息"): ShippingContact[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOMER_ADDRESSES) throw new Error(`${label}最多可填写 ${MAX_CUSTOMER_ADDRESSES} 条`);
  const rows = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label}格式不正确`);
    const entry = item as Record<string, unknown>;
    if (![entry.address, entry.recipient, entry.phone].every((part) => typeof part === "string")) throw new Error(`${label}格式不正确`);
    return { address: String(entry.address).trim(), recipient: String(entry.recipient).trim(), phone: String(entry.phone).trim() };
  });
  for (const row of rows) {
    if (!row.address || !row.recipient || !row.phone) throw new Error(`每条${label}都需填写收货地址、收货人和联系电话`);
    if (row.address.length > 500 || row.recipient.length > 200 || row.phone.length > 100) throw new Error(`${label}超出允许长度`);
    row.phone = normalizeManualPhone(row.phone, "收货人电话");
    const digits = row.phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15 || /^(\d)\1+$/.test(digits)) throw new Error("收货人电话须为有效的 7 至 15 位号码");
  }
  validateAddressList(rows.map((row) => row.address), label);
  return rows;
}

export function displayAddressList(list: string[] | null | undefined, primary: string | null | undefined): string[] {
  if (Array.isArray(list)) {
    const values = list.map((value) => String(value || "").trim()).filter(Boolean);
    if (values.length) return values;
  }
  return primary?.trim() ? [primary.trim()] : [];
}

export function validateAddressList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOMER_ADDRESSES) {
    throw new Error(`${label}最多可填写 ${MAX_CUSTOMER_ADDRESSES} 条`);
  }
  const addresses = value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length > 500) throw new Error(`${label}每条不能超过 500 字`);
    return entry.trim();
  }).filter(Boolean);
  if (new Set(addresses).size !== addresses.length) throw new Error(`${label}不能重复`);
  return addresses;
}

export function normalizeAddressPayload(body: Record<string, unknown>): void {
  if ("shipping_contact_entries" in body) {
    const entries = validateShippingContacts(body.shipping_contact_entries);
    body.shipping_contact_entries = entries;
    body.shipping_addresses = entries.map((entry) => entry.address);
  }
  if ("forwarder_contact_entries" in body) {
    const entries = validateShippingContacts(body.forwarder_contact_entries, "货代收货信息");
    body.forwarder_contact_entries = entries;
    body.forwarder_addresses = entries.map((entry) => entry.address);
  }
  for (const [listKey, primaryKey, label] of [
    ["shipping_addresses", "shipping_address", "客户收货地址"],
    ["forwarder_addresses", "forwarder_address", "货代地址"],
  ] as const) {
    if (listKey in body) {
      const addresses = validateAddressList(body[listKey], label);
      body[listKey] = addresses;
      body[primaryKey] = addresses[0] || null;
    }
  }
}
