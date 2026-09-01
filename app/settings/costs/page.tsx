import { CostCenterView } from "@/components/cost-center-view";
import { requirePermission } from "@/lib/auth/current-user";

export default async function CostSettingsPage() {
  await requirePermission("costs.view");
  return <CostCenterView embedded />;
}
