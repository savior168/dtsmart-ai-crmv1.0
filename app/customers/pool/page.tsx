import { CustomerPublicPoolView } from "@/components/customer-public-pool-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

export default async function CustomerPublicPoolPage() {
  const { account } = await protectPage("customers.pool.view");
  return <CustomerPublicPoolView initialRole={account.role} initialCanExport={hasPermission(account, "customers.pool.export")} />;
}
