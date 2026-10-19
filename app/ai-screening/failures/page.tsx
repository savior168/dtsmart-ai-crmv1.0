import { FailuresView } from "@/components/ai-screening/failures-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function AiFailuresPage(){await protectPage("ai.results.view");return <FailuresView/>}
