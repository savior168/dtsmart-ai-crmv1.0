import { TaskCenterView } from "@/components/ai-screening/task-center-view";
import { hasPermission, requireUser } from "@/lib/auth/current-user";

export default async function AiScreeningPage() {
  const { account } = await requireUser();
  return <TaskCenterView
    canViewUsage={hasPermission(account,"ai.usage.view")}
    canManageSettings={hasPermission(account,"ai.settings.manage")}
    canCreate={hasPermission(account,"ai.tasks.create")}
  />;
}
