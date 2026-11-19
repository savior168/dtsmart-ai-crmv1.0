import { SalesReportsView } from "@/components/sales-reports-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

export default async function SalesPerformancePage() {
  const { account } = await protectPage("sales.performance.view");
  return <SalesReportsView mode="performance" canFilterOwner={hasPermission(account,"sales.performance.data_all")} />;
}
