import { BatchOrderPrintPreview } from "@/components/batch-order-print-preview";
import { protectPage } from "@/lib/auth/page-access";

export default async function BatchStockPreviewPage() {
  await protectPage("stock.export");
  return <BatchOrderPrintPreview kind="stock"/>;
}
