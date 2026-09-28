import { ProductPriceImportView } from "@/components/product-price-import-view";
import { protectPage } from "@/lib/auth/page-access";

export const dynamic = "force-dynamic";

export default async function ProductPriceImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await protectPage("pricebooks.import");
  const { id } = await params;
  return <ProductPriceImportView id={id}/>;
}
