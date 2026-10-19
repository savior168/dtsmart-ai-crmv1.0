import { ProductCategoriesView } from "@/components/product-categories-view";
import { protectPage } from "@/lib/auth/page-access";

export default async function ProductCategoriesPage() {
  await protectPage("products.categories.view");
  return <ProductCategoriesView />;
}
