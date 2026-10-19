import { TaskDetailView } from "@/components/ai-screening/task-detail-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";
export default async function AiTaskDetailPage({params}:{params:Promise<{id:string}>}){const {account}=await protectPage("ai.tasks.view");const{id}=await params;return <TaskDetailView taskId={id} canViewResults={hasPermission(account,"ai.results.view")} canControl={hasPermission(account,"ai.tasks.control")} canArchive={hasPermission(account,"ai.tasks.delete")}/>}
