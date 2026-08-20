import { TaskDetailView } from "@/components/ai-screening/task-detail-view";
export default async function AiTaskDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <TaskDetailView taskId={id}/>}
