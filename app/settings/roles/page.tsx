import { redirect } from "next/navigation";
import { protectPage } from "@/lib/auth/page-access";
export default async function RolesSettingsPage() { await protectPage("system.users.view"); redirect("/settings/users"); }
