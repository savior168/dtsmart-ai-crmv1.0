export function assertSupplierRoleAllowed(role: string) {
  if (role === "SALES" || role === "ORDER_CLERK") throw new Error("FORBIDDEN");
}
