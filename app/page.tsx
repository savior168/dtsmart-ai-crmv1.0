import { CrmDashboard } from "@/components/crm-dashboard";
import { WarehouseDashboard } from "@/components/warehouse-dashboard";
import { OperationsOverview } from "@/components/operations-overview";
import Link from "next/link";
import { redirect } from "next/navigation";
import { protectAuthenticatedPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

const landingPermissions = [
  ["dashboard.view", "/"], ["orders.view", "/orders"], ["stock.view", "/stock-orders"],
  ["customers.view", "/customers"], ["reports.view", "/reports"],
  ["products.view", "/products"], ["products.categories.view", "/products/categories"],
  ["pricebooks.view", "/products/prices"], ["pricebooks.rules.view", "/products/pricing"],
  ["followups.view", "/followups"], ["imports.view", "/import"],
  ["ai.acquisition.view", "/ai-acquisition"], ["ai.tasks.view", "/ai-screening"],
  ["pi.rates.view", "/settings/pi-exchange-rates"], ["pi.accounts.view", "/settings/pi-payment-accounts"],
  ["system.users.view", "/settings/users"], ["costs.view", "/settings/costs"],
  ["system.audit.view", "/settings/audit"], ["system.notifications.view", "/settings/notifications"],
  ["system.security.view", "/settings/security"],
] as const;

export default async function Home() {
  const { account } = await protectAuthenticatedPage();
  if (!hasPermission(account, "dashboard.view")) {
    const target = landingPermissions.find(([permission]) => hasPermission(account, permission))?.[1];
    if (target) redirect(target);
    return <main className="grid min-h-[calc(100vh-64px)] place-items-center p-6"><section className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-semibold">欢迎使用智客云</h1><p className="mt-3 text-sm leading-6 text-slate-600">账号已正常登录，目前尚未配置可进入的业务页面。请联系系统管理员在“用户与权限”中按岗位开通；开通前不会显示其他人的业务数据。</p><Link href="/profile" className="mt-6 inline-flex rounded-lg border px-5 py-2.5 text-sm font-medium">查看个人资料</Link></section></main>;
  }
  if (account.role === "ORDER_CLERK") return <OperationsOverview role="ORDER_CLERK" userId={account.id} canViewOrders={hasPermission(account, "orders.view")} canFilterCreator={hasPermission(account, "orders.data_all")} canViewStock={hasPermission(account, "stock.view")} />;
  if (account.role === "WAREHOUSE") return hasPermission(account, "stock.view") ? <WarehouseDashboard /> : <OperationsOverview role="WAREHOUSE" userId={account.id} canViewOrders={false} canFilterCreator={false} canViewStock={false} />;
  return <CrmDashboard canCreateAcquisition={hasPermission(account, "ai.acquisition.create")} />;
}
