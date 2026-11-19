import {protectPage} from "@/lib/auth/page-access";
import {hasPermission} from "@/lib/auth/current-user";
import {OrdersView} from "@/components/orders-view";
export default async function OrdersPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {account}=await protectPage("orders.view");
  const params=await searchParams;
  const value=(key:string)=>typeof params[key]==="string"?params[key] as string:"";
  const filters={
    status:value("status"),
    dateFrom:value("date_from"),
    dateTo:value("date_to"),
    creatorId:value("creator_id"),
  };
  return <OrdersView key={JSON.stringify(filters)} initialFilters={filters} canFilterOwner={hasPermission(account,"orders.data_all")} initialCanFilterCreator={["ADMIN","ORDER_CLERK"].includes(account.role)&&hasPermission(account,"orders.data_all")}/>;
}
