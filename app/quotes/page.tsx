import { QuotesView } from "@/components/quotes-view";
import { protectPage } from "@/lib/auth/page-access";

export default async function QuotesPage(){await protectPage("quotes.view");return <QuotesView/>}
