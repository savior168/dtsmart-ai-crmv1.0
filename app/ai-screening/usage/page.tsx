import { UsageView } from "@/components/ai-screening/usage-view";
import { requirePermission } from "@/lib/auth/current-user";

export default async function AiUsagePage(){
  await requirePermission("ai.usage.view");
  return <UsageView/>;
}
