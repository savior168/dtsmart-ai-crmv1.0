import { ImportView } from "@/components/import-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ destination?: string }> }) {
  const { account } = await protectPage("imports.view");
  const params = await searchParams;
  if (params.destination === "public" && account.role !== "ADMIN") redirect("/access-denied?permission=imports.create");
  return <ImportView destination={params.destination === "public" ? "PUBLIC_POOL" : "PRIVATE"} canCreate={hasPermission(account, "imports.create")}/>;
}
