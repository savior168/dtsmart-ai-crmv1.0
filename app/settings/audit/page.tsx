import { AuditLogPanel } from "@/components/admin-settings-panels";
import { requirePermission } from "@/lib/auth/current-user";
export default async function AuditSettingsPage() { await requirePermission("system.audit.view"); return <AuditLogPanel />; }
