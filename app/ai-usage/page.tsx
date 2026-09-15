import { AiUsageCenter } from "@/components/ai-usage-center";
import { hasPermission, requireUser } from "@/lib/auth/current-user";

export default async function AiUsagePage({ searchParams }:{ searchParams:Promise<{module?:string}> }) {
  const { account } = await requireUser();
  const canViewScreening = hasPermission(account,"ai.usage.view");
  const canViewAcquisition = hasPermission(account,"ai.acquisition.usage.view");
  const canViewCostCenter = hasPermission(account,"costs.view");
  if (!canViewScreening && !canViewAcquisition) throw new Error("FORBIDDEN");
  const requested = (await searchParams).module;
  const initialModule = requested === "acquisition" && canViewAcquisition
    ? "acquisition"
    : canViewScreening ? "screening" : "acquisition";
  return <AiUsageCenter canViewScreening={canViewScreening} canViewAcquisition={canViewAcquisition} canViewCostCenter={canViewCostCenter} initialModule={initialModule}/>;
}
