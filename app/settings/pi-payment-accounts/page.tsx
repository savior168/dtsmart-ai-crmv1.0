import { requirePermission } from "@/lib/auth/current-user";
import { PiPaymentAccounts } from "@/components/pi-payment-accounts";

export default async function PiPaymentAccountsPage() {
  const { account } = await requirePermission("pi.accounts.view");
  if (account.role !== "ADMIN") throw new Error("FORBIDDEN");
  return <PiPaymentAccounts />;
}
