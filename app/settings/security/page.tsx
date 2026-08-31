import { SecuritySettingsPanel } from "@/components/admin-settings-panels";
import { requirePermission } from "@/lib/auth/current-user";
export default async function SecuritySettingsPage() { await requirePermission("system.security.view"); return <SecuritySettingsPanel />; }
