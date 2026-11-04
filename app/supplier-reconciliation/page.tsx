import { SupplierReconciliationView } from "@/components/supplier-reconciliation-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

export default async function SupplierReconciliationPage() {
  const { account } = await protectPage("supplier.reconciliation.view");
  return <SupplierReconciliationView canRecordPayment={hasPermission(account, "supplier.reconciliation.manage")} />;
}
