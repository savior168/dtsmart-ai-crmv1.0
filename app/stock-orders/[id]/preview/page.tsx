import { protectPage } from "@/lib/auth/page-access";
import { OrderPrintPreview } from "@/components/order-print-preview";

export default async function StockPreviewPage({params}:{params:Promise<{id:string}>}) {
  await protectPage("stock.view");
  const {id}=await params;
  return <OrderPrintPreview kind="stock" id={id}/>;
}
