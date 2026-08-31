import { CrmDashboard } from "@/components/crm-dashboard";
import { protectPage } from "@/lib/auth/page-access";

export default async function Home() {
  await protectPage("dashboard.view");
  return <CrmDashboard />;
}
