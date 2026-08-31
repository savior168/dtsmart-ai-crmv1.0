import { FollowupsView } from "@/components/followups-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function FollowupsPage(){await protectPage("followups.view");return <FollowupsView/>}
