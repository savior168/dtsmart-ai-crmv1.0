import { ResultsView } from "@/components/ai-screening/results-view";
export default async function AiTaskReportPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <ResultsView taskId={id} report/>}
