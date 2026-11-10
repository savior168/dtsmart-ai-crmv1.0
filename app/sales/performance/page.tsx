import { SalesReportsView } from "@/components/sales-reports-view";
import { protectPage } from "@/lib/auth/page-access";

export default async function SalesPerformancePage() {
  await protectPage("sales.performance.view");
  return <SalesReportsView mode="performance" />;
}
