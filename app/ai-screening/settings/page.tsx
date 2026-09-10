import { AiScreeningSettingsView } from "@/components/ai-screening/settings-view";
import { requirePermission } from "@/lib/auth/current-user";

export default async function AiScreeningSettingsPage() {
  await requirePermission("ai.settings.manage");
  return <AiScreeningSettingsView/>;
}
