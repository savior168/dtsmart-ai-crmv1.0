export function matchActiveSupplierCode<T extends { id: string; system_code: string }>(
  suppliers: T[], input: string,
): T | undefined {
  const code = input.trim().toUpperCase();
  return code ? suppliers.find((supplier) => supplier.system_code === code) : undefined;
}
