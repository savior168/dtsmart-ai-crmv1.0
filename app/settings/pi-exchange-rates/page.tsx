import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { PiExchangeRates } from "@/components/pi-exchange-rates";

export default async function PiExchangeRatesPage() {
  const { account } = await requirePermission("pi.rates.view");
  return <PiExchangeRates canManage={hasPermission(account, "pi.rates.manage")} />;
}
