import { ResultsView } from "@/components/ai-screening/results-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function AiTaskReportPage({params}:{params:Promise<{id:string}>}){await protectPage("ai.results.view");const{id}=await params;return <ResultsView taskId={id} report/>}
