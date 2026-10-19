export const MAX_CUSTOMER_ADDRESSES = 10;

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
