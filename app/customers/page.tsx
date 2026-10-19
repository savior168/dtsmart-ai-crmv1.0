import { CustomersView } from "@/components/customers-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

export default async function CustomersPage() {
  const { account } = await protectPage("customers.view");
  return <CustomersView canCreate={hasPermission(account, "customers.create")} canImport={hasPermission(account, "imports.create")} />;
}
