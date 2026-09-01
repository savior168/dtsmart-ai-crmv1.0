import { QuoteForm } from "@/components/quote-form";
import { protectPage } from "@/lib/auth/page-access";

export default async function QuoteDetailPage({params}:{params:Promise<{id:string}>}){await protectPage("quotes.view");const {id}=await params;return <QuoteForm quoteId={id}/>}
