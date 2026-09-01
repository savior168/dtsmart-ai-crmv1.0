import {protectPage} from"@/lib/auth/page-access";import{QuotePrintView}from"@/components/quote-print-view";
export default async function QuotePrintPage({params}:{params:Promise<{id:string}>}){await protectPage("quotes.export");const{id}=await params;return <QuotePrintView id={id}/>}
