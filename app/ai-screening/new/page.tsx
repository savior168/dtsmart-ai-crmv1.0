import { CreateTaskView } from "@/components/ai-screening/create-task-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function NewAiScreeningTaskPage(){await protectPage("ai.tasks.create");return <CreateTaskView/>}
