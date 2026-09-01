import { QuoteForm } from "@/components/quote-form";
import { protectPage } from "@/lib/auth/page-access";

export default async function NewQuotePage({searchParams}:{searchParams:Promise<{customer_id?:string}>}){await protectPage("quotes.create");const params=await searchParams;return <QuoteForm initialCustomerId={params.customer_id||""}/>}
