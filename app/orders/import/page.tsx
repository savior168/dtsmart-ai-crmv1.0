import { protectPage } from "@/lib/auth/page-access";
import { PiImportView } from "@/components/pi-import-view";

export default async function ImportPiPage() {
  await protectPage("orders.import");
  return <PiImportView />;
}
