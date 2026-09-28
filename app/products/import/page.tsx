import { ProductImportView } from "@/components/product-import-view";
import { protectPage } from "@/lib/auth/page-access";
export const dynamic = "force-dynamic";
export default async function ProductImportPage(){await protectPage("pricebooks.import");return <ProductImportView/>}
