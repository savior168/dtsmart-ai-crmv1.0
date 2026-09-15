import { AcquisitionTaskDetail } from "@/components/ai-acquisition/task-detail";
export default async function AcquisitionDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AcquisitionTaskDetail taskId={id}/>;}
