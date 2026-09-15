import { CostCenterView } from "@/components/cost-center-view";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";

export default async function CostSettingsPage() {
  const { account } = await requirePermission("costs.view");
  const canViewAiUsage = hasPermission(account,"ai.usage.view") || hasPermission(account,"ai.acquisition.usage.view");
  return <CostCenterView embedded canViewAiUsage={canViewAiUsage} />;
}
