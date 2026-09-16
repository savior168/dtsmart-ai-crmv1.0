import { AcquisitionCustomerResults } from "@/components/ai-acquisition/customer-results";
import { requirePermission } from "@/lib/auth/current-user";

export default async function Page({ searchParams }:{ searchParams:Promise<{scope?:string}> }) {
  await requirePermission("ai.acquisition.view");
  const requested = (await searchParams).scope || "accepted";
  const scope = (["today","accepted","review"].includes(requested) ? requested : "accepted") as "today"|"accepted"|"review";
  return <AcquisitionCustomerResults initialScope={scope}/>;
}
