import { QuotesView } from "@/components/quotes-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";

export default async function QuotesPage(){const {account}=await protectPage("quotes.view");return <QuotesView canFilterOwner={hasPermission(account,"quotes.data_all")}/>}
