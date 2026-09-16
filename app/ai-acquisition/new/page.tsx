import { AcquisitionCreateView } from "@/components/ai-acquisition/create-view";
import { requirePermission } from "@/lib/auth/current-user";

export default async function NewAcquisitionPage(){
  await requirePermission("ai.acquisition.create");
  return <AcquisitionCreateView/>;
}
