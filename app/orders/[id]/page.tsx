import {protectPage} from "@/lib/auth/page-access";
import {OrderDetailView} from "@/components/order-detail-view";
export default async function OrderPage({params}:{params:Promise<{id:string}>}){await protectPage("orders.view");const{id}=await params;return <OrderDetailView id={id}/>}
