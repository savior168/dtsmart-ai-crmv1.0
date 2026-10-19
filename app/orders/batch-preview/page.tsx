import { BatchOrderPrintPreview } from "@/components/batch-order-print-preview";
import { protectPage } from "@/lib/auth/page-access";

export default async function BatchPiPreviewPage() {
  await protectPage("orders.export");
  return <BatchOrderPrintPreview kind="pi"/>;
}
