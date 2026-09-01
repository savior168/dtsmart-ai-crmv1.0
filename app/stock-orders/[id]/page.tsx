import { StockOrderDetailView } from "@/components/stock-order-detail-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function StockOrderPage({params}:{params:Promise<{id:string}>}){await protectPage("stock.view");const {id}=await params;return <StockOrderDetailView id={id}/>}
