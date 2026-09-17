import { requirePermission } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";

export default async function Page() {
  await requirePermission("ai.acquisition.usage.view");
  redirect("/ai-usage?business_type=acquisition");
}
