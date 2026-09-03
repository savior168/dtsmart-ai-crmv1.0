import { CustomerPublicPoolView } from "@/components/customer-public-pool-view";
import { protectPage } from "@/lib/auth/page-access";

export default async function CustomerPublicPoolPage() {
  const { account } = await protectPage("customers.view");
  return <CustomerPublicPoolView initialRole={account.role} />;
}
