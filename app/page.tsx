import { CrmDashboard } from "@/components/crm-dashboard";
import { WarehouseDashboard } from "@/components/warehouse-dashboard";
import { OrderClerkDashboard } from "@/components/order-clerk-dashboard";
import { FinanceDashboard } from "@/components/finance-dashboard";
import { redirect } from "next/navigation";
import { protectAuthenticatedPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";
import { firstAuthorizedPage } from "@/lib/auth/landing-page";

export default async function Home() {
  const { account } = await protectAuthenticatedPage();
  if (!hasPermission(account, "dashboard.view")) {
    redirect(firstAuthorizedPage((permission) => hasPermission(account, permission)) || "/access-denied");
  }
  if (account.role === "WAREHOUSE") return <WarehouseDashboard />;
  if (account.role === "ORDER_CLERK") return <OrderClerkDashboard />;
  if (account.role === "FINANCE") return <FinanceDashboard
    canViewReconciliation={hasPermission(account, "supplier.reconciliation.view")}
    canViewSuppliers={hasPermission(account, "suppliers.view")}
    canViewNotifications={hasPermission(account, "notifications.view")}
  />;
  return <CrmDashboard
    showPerformance={["ADMIN", "SUPERVISOR", "SALES"].includes(account.role) && hasPermission(account, "reports.view")}
    canImportCustomers={hasPermission(account, "imports.create")}
    canCreateAiScreening={account.role === "ADMIN"}
  />;
}
