import { UserAccessManagementPanel } from "@/components/admin-settings-panels";
import { requireAdmin } from "@/lib/auth/current-user";
export default async function UsersSettingsPage() { await requireAdmin(); return <UserAccessManagementPanel />; }
