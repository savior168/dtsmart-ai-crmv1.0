import { SalesReportsView } from "@/components/sales-reports-view";
import { OperationsOverview } from "@/components/operations-overview";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

export default async function ReportsPage() {
  const { account } = await protectPage("reports.view");
  if (account.role === "ORDER_CLERK") return <OperationsOverview role="ORDER_CLERK" userId={account.id} canViewOrders={hasPermission(account, "orders.view")} canFilterCreator={hasPermission(account, "orders.data_all")} canViewStock={hasPermission(account, "stock.view")} report />;
  if (account.role === "WAREHOUSE") return <OperationsOverview role="WAREHOUSE" userId={account.id} canViewOrders={false} canFilterCreator={false} canViewStock={hasPermission(account, "stock.view")} report />;
  return <SalesReportsView />;
}
