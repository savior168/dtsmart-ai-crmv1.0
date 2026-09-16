import { AcquisitionTaskCenter } from "@/components/ai-acquisition/task-center";
import { hasPermission, requireUser } from "@/lib/auth/current-user";

export default async function AiAcquisitionPage(){
  const { account } = await requireUser();
  return <AcquisitionTaskCenter
    canCreate={hasPermission(account,"ai.acquisition.create")}
    canViewUsage={hasPermission(account,"ai.acquisition.usage.view")}
    canManageSettings={hasPermission(account,"ai.acquisition.settings.manage")}
    canViewGoogleBilling={hasPermission(account,"costs.view")||hasPermission(account,"ai.cost_summary.view")}
    canControl={hasPermission(account,"ai.acquisition.control")}
  />;
}
