import { protectPage } from "@/lib/auth/page-access";
import { PiOrderForm } from "@/components/pi-order-form";

export default async function EditPiOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await protectPage("orders.edit");
  const { id } = await params;
  return <PiOrderForm draftOrderId={id} />;
}
