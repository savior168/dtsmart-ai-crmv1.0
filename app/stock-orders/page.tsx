import { StockOrdersView } from "@/components/stock-orders-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function StockOrdersPage(){await protectPage("stock.view");return <StockOrdersView/>}
