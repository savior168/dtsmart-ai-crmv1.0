import { requirePermission } from "@/lib/auth/current-user";
import { NotificationsView } from "@/components/notifications-view";

export default async function NotificationsPage(){await requirePermission("notifications.view");return <NotificationsView/>}
