import { FollowupsView } from "@/components/followups-view";
import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";
export default async function FollowupsPage(){const {account}=await protectPage("followups.view");return <FollowupsView canFilterOwner={hasPermission(account,"followups.data_all")}/>}
