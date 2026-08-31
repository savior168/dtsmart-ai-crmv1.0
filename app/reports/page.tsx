import { SalesReportsView } from "@/components/sales-reports-view";
import { protectPage } from "@/lib/auth/page-access";

export default async function ReportsPage() {
  await protectPage("reports.view");
  return <SalesReportsView />;
}
