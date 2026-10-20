import { StockOrdersView } from "@/components/stock-orders-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function StockOrdersPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await protectPage("stock.view");
  const params=await searchParams;
  const value=(key:string)=>typeof params[key]==="string"?params[key] as string:"";
  const filters={status:value("status"),dateFrom:value("date_from"),dateTo:value("date_to"),creatorId:value("creator_id")};
  return <StockOrdersView key={JSON.stringify(filters)} initialFilters={filters}/>;
}
