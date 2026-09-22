import { ProductCatalogView } from "@/components/product-catalog-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function ProductsPage(){await protectPage("products.view");return <ProductCatalogView/>}
