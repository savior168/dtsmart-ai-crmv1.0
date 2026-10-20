import { UserAccessManagementPanel } from "@/components/admin-settings-panels";
import { protectPage } from "@/lib/auth/page-access";
export default async function UsersSettingsPage() { await protectPage("system.users.view"); return <UserAccessManagementPanel />; }
