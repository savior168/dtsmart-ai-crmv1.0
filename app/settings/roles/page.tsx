import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/current-user";
export default async function RolesSettingsPage() { await requireAdmin(); redirect("/settings/users"); }
