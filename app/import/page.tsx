import { ImportView } from "@/components/import-view";
import { protectPage } from "@/lib/auth/page-access";
import { requireAdmin } from "@/lib/auth/current-user";
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ destination?: string }> }) {
  await protectPage("imports.view");
  const params = await searchParams;
  if (params.destination === "public") await requireAdmin();
  return <ImportView destination={params.destination === "public" ? "PUBLIC_POOL" : "PRIVATE"}/>;
}
