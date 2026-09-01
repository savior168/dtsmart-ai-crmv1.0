import {protectPage} from "@/lib/auth/page-access";
import {OrdersView} from "@/components/orders-view";
export default async function OrdersPage(){await protectPage("orders.view");return <OrdersView/>}
