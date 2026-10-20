import { protectPage } from "@/lib/auth/page-access";
import { PiOrderForm } from "@/components/pi-order-form";

export default async function NewPiOrderPage({ searchParams }: { searchParams: Promise<{ customer_id?: string }> }) {
  const { account } = await protectPage("orders.create");
  const { customer_id } = await searchParams;
  return <PiOrderForm initialCustomerId={customer_id || ""} initialIsClerk={account.role === "ORDER_CLERK"} />;
}
