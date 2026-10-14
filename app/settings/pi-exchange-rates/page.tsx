import { requirePermission } from "@/lib/auth/current-user";
import { PiExchangeRates } from "@/components/pi-exchange-rates";

export default async function PiExchangeRatesPage() {
  const { account } = await requirePermission("pi.rates.view");
  if (account.role !== "ADMIN") throw new Error("FORBIDDEN");
  return <PiExchangeRates />;
}
