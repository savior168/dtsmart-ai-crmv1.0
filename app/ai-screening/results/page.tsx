import { ResultsView } from "@/components/ai-screening/results-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function AiResultsPage(){await protectPage("ai.results.view");return <ResultsView/>}
