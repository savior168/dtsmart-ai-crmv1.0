import { redirect } from "next/navigation";
import { SalesReportsView } from "@/components/sales-reports-view";
import { protectPage } from "@/lib/auth/page-access";

export default async function SalesPerformancePage() {
  const { account } = await protectPage("reports.view");
  if (!["ADMIN", "SUPERVISOR", "SALES"].includes(account.role)) redirect("/reports");
  return <SalesReportsView mode="performance" />;
}
