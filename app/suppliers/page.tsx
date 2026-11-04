import { SuppliersView } from "@/components/suppliers-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

export default async function SuppliersPage() {
  const { account } = await protectPage("suppliers.view");
  return <SuppliersView canManage={hasPermission(account, "suppliers.manage")} />;
}
