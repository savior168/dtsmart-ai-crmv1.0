import { ProductImportReviewView } from "@/components/product-import-review-view";
import { protectPage } from "@/lib/auth/page-access";
export default async function ProductImportReviewPage({params}:{params:Promise<{id:string}>}){await protectPage("pricebooks.import");const{id}=await params;return <ProductImportReviewView id={id}/>}
