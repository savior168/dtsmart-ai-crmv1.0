export type CustomerIdentityInput = {
  company_name?: unknown;
  phone?: unknown;
  email?: unknown;
};

export function normalizeIdentityText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeIdentityPhone(value: unknown) {
  return normalizeIdentityText(value).replace(/[^0-9]/g, "");
}

export function customerIdentityKeys(row: CustomerIdentityInput) {
  const name = normalizeIdentityText(row.company_name);
  const phone = normalizeIdentityPhone(row.phone);
  const email = normalizeIdentityText(row.email);
  if (!name) return [];
  return [
    phone ? `phone:${name}|${phone}` : "",
    email ? `email:${name}|${email}` : "",
  ].filter(Boolean);
}
