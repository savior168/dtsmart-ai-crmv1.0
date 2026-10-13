import { redirect } from "next/navigation";
import { protectPage } from "@/lib/auth/page-access";

export default async function NewQuotePage({searchParams}:{searchParams:Promise<{customer_id?:string}>}){await protectPage("orders.create");const params=await searchParams;redirect(`/orders/new${params.customer_id ? `?customer_id=${encodeURIComponent(params.customer_id)}` : ""}`)}
