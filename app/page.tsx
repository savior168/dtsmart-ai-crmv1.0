import { CrmDashboard } from "@/components/crm-dashboard";
import { WarehouseDashboard } from "@/components/warehouse-dashboard";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

export default async function Home() {
  const { account } = await protectPage("dashboard.view");
  return account.role === "WAREHOUSE" ? <WarehouseDashboard /> : <CrmDashboard showPerformance={["ADMIN", "SUPERVISOR", "SALES"].includes(account.role) && hasPermission(account, "reports.view")} />;
}
