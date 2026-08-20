import { EvidenceView } from "@/components/ai-screening/evidence-view";
export default async function AiEvidencePage({params,searchParams}:{params:Promise<{customerId:string}>;searchParams:Promise<{task?:string}>}){const[{customerId},query]=await Promise.all([params,searchParams]);return <EvidenceView customerId={customerId} taskId={query.task}/>}
