import { ImportView } from "@/components/import-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function ImportPage(){await protectPage("imports.view");return <ImportView/>}
