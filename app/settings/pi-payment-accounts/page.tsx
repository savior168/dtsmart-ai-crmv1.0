import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { PiPaymentAccounts } from "@/components/pi-payment-accounts";

export default async function PiPaymentAccountsPage() {
  const { account } = await requirePermission("pi.accounts.view");
  return <PiPaymentAccounts canManage={hasPermission(account, "pi.accounts.manage")} />;
}
