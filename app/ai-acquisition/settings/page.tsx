import { AiScreeningSettingsView } from "@/components/ai-screening/settings-view";
import { requirePermission } from "@/lib/auth/current-user";

export default async function AiAcquisitionSettingsPage() {
  await requirePermission("ai.acquisition.settings.manage");
  return <AiScreeningSettingsView scope="acquisition"/>;
}
