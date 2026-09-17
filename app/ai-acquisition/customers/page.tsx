import { AcquisitionCustomerResults } from "@/components/ai-acquisition/customer-results";
import { requirePermission } from "@/lib/auth/current-user";

export default async function Page({ searchParams }:{ searchParams:Promise<{scope?:string;user_id?:string;task_id?:string}> }) {
  await requirePermission("ai.acquisition.view");
  const query = await searchParams;
  const requested = query.scope || "accepted";
  const scope = (["today","accepted","review"].includes(requested) ? requested : "accepted") as "today"|"accepted"|"review";
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return <AcquisitionCustomerResults initialScope={scope} initialOwnerId={query.user_id || ""} initialTaskId={query.task_id || ""} initialDate={scope === "today" ? today : ""}/>;
}
