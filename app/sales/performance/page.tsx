import { SalesReportsView } from "@/components/sales-reports-view";
import { protectPage } from "@/lib/auth/page-access";

export default async function SalesPerformancePage() {
  await protectPage("reports.view");
  return <SalesReportsView mode="performance" />;
}
