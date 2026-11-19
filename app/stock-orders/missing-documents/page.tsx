import { protectPage } from "@/lib/auth/page-access";
import { hasPermission } from "@/lib/auth/current-user";
import { MissingStockDocumentsView } from "@/components/missing-stock-documents-view";
import { redirect } from "next/navigation";

export default async function MissingStockDocumentsPage() {
  const { account } = await protectPage("stock.view");
  if (!["WAREHOUSE", "ADMIN"].includes(account.role)
    || !["stock.update", "stock.procurement.edit", "supplier.documents.view", "supplier.documents.manage"]
      .every((permission) => hasPermission(account, permission))) redirect("/access-denied");
  return <MissingStockDocumentsView showLegacySources canEditLegacySources={account.role === "WAREHOUSE"}/>;
}
