import { ImportView } from "@/components/import-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission, requireAdmin } from "@/lib/auth/current-user";
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ destination?: string }> }) {
  const { account } = await protectPage("imports.view");
  const params = await searchParams;
  if (params.destination === "public") await requireAdmin();
  return <ImportView destination={params.destination === "public" ? "PUBLIC_POOL" : "PRIVATE"} canCreate={hasPermission(account, "imports.create")}/>;
}
