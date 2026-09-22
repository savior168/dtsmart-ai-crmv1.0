import { ProductPricebookView } from "@/components/product-pricebook-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function ProductPricesPage(){await protectPage("pricebooks.view");return <ProductPricebookView/>}
