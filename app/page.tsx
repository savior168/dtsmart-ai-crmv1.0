import { CrmDashboard } from "@/components/crm-dashboard";
import { WarehouseDashboard } from "@/components/warehouse-dashboard";
import { redirect } from "next/navigation";
import { protectAuthenticatedPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";
import { firstAuthorizedPage } from "@/lib/auth/landing-page";

export default async function Home() {
  const { account } = await protectAuthenticatedPage();
  if (!hasPermission(account, "dashboard.view")) {
    redirect(firstAuthorizedPage((permission) => hasPermission(account, permission)) || "/access-denied");
  }
  return account.role === "WAREHOUSE" ? <WarehouseDashboard /> : <CrmDashboard showPerformance={["ADMIN", "SUPERVISOR", "SALES"].includes(account.role) && hasPermission(account, "reports.view")} />;
}
