import { protectPage } from "@/lib/auth/page-access";
import { OrderPrintPreview } from "@/components/order-print-preview";

export default async function PiPreviewPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{export?:string}>}) {
  const mode = (await searchParams).export;
  await protectPage(mode === "pdf" ? "orders.export" : "orders.preview");
  const {id}=await params;
  return <OrderPrintPreview kind="pi" id={id}/>;
}
