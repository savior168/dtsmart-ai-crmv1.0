import { CrmDashboard } from "@/components/crm-dashboard";
import { WarehouseDashboard } from "@/components/warehouse-dashboard";
import { requirePermission } from "@/lib/auth/current-user";

export default async function Home() {
  const { account } = await requirePermission("dashboard.view");
  return account.role === "WAREHOUSE" ? <WarehouseDashboard /> : <CrmDashboard />;
}
