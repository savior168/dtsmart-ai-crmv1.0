import { AcquisitionCustomerResults } from "@/components/ai-acquisition/customer-results";
import { requirePermission } from "@/lib/auth/current-user";

export default async function Page({ searchParams }:{ searchParams:Promise<{scope?:string;user_id?:string;task_id?:string;task_search?:string;task_cost_mode?:string;task_country?:string|string[];task_industry?:string|string[];task_from?:string;task_to?:string}> }) {
  await requirePermission("ai.acquisition.view");
  const query = await searchParams;
  const requested = query.scope || "accepted";
  const scope = (["today","week","accepted","review"].includes(requested) ? requested : "accepted") as "today"|"week"|"accepted"|"review";
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const today = chinaNow.toISOString().slice(0, 10);
  const monday = new Date(chinaNow);
  monday.setUTCDate(chinaNow.getUTCDate() - ((chinaNow.getUTCDay() + 6) % 7));
  const initialDate = scope === "today" ? today : scope === "week" ? monday.toISOString().slice(0, 10) : "";
  return <AcquisitionCustomerResults initialScope={scope} initialOwnerId={query.user_id || ""} initialTaskId={query.task_id || ""} initialTaskSearch={query.task_search || ""} initialTaskFilters={{costMode:query.task_cost_mode || "",countries:[query.task_country || []].flat(),industries:[query.task_industry || []].flat(),from:query.task_from || "",to:query.task_to || ""}} initialDate={initialDate} initialEndDate={scope === "week" ? today : ""}/>;
}
