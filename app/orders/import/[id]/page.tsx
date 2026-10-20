import { protectPage } from "@/lib/auth/page-access";
import { PiOrderForm } from "@/components/pi-order-form";

export default async function CompleteImportedPiPage({ params }: { params: Promise<{ id: string }> }) {
  await protectPage("orders.import");
  const { account } = await protectPage("orders.create");
  const { id } = await params;
  return <PiOrderForm importDraftId={id} initialIsClerk={account.role === "ORDER_CLERK"} />;
}
