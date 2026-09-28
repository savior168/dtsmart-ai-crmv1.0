import { ProductPriceImportView } from "@/components/product-price-import-view";
import { protectPage } from "@/lib/auth/page-access";

export const dynamic = "force-dynamic";

export default async function ProductPriceImportPage() {
  await protectPage("pricebooks.import");
  return <ProductPriceImportView/>;
}
