import { AcquisitionCustomerResults } from "@/components/ai-acquisition/customer-results";
import { requirePermission } from "@/lib/auth/current-user";

export default async function Page({ searchParams }:{ searchParams:Promise<{scope?:string;user_id?:string}> }) {
  await requirePermission("ai.acquisition.view");
  const query = await searchParams;
  const requested = query.scope || "accepted";
  const scope = (["today","accepted","review"].includes(requested) ? requested : "accepted") as "today"|"accepted"|"review";
  return <AcquisitionCustomerResults initialScope={scope} initialOwnerId={query.user_id || ""}/>;
}
