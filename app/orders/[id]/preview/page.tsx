import { protectPage } from "@/lib/auth/page-access";
import { OrderPrintPreview } from "@/components/order-print-preview";

export default async function PiPreviewPage({params}:{params:Promise<{id:string}>}) {
  await protectPage("orders.view");
  const {id}=await params;
  return <OrderPrintPreview kind="pi" id={id}/>;
}
